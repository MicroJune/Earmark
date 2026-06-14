import * as FS from 'expo-file-system/legacy';
import { AppState, Platform } from 'react-native';

// ─── Logging system ───────────────────────────────────────────────────────────
// Designed around the failure modes that made the lock-screen-freeze bug so hard
// to diagnose:
//   • The app was KILLED on a freeze → in-memory logs vanished, and the
//     async-queued file writes hadn't flushed. We never even knew a crash
//     happened.  → We now persist a session record and, on the next launch,
//     report whether the previous session ended abnormally (crash / ANR / kill).
//   • The freeze itself produced no signal.  → A watchdog timer detects when the
//     JS thread was blocked and logs how long.
//   • JS errors went uncaught and unlogged.  → A global error handler records
//     fatal/uncaught errors before the app dies.
//   • The phone's ROM (vivo) suppresses logcat.  → Logs persist to a file (with
//     rotation) and can be live-streamed to the laptop log server, independent
//     of logcat.
//   • Logs lacked context (which screen / file / app state).  → A context map is
//     attached to every entry.
//
// Public API (log.debug/info/warn/error, getLogEntries, subscribeToLogs,
// getLogFilePath, clearLogFile, clearLogEntries) is unchanged so all existing
// call sites and the Log Viewer keep working. New: initLogger(), log.setContext,
// log.clearContext, setLiveForward.

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: number;
  time: string;   // HH:MM:SS.mmm (local)
  level: Level;
  tag: string;
  message: string;
  detail?: string;
  context?: Record<string, string | number | boolean>;
}

// ─── Config ─────────────────────────────────────────────────────────────────
const MAX_ENTRIES = 500;                 // in-memory ring buffer for the viewer
const MAX_FILE_BYTES = 512 * 1024;       // rotate the log file past this size
const LOG_FILE = 'app.log';
const LOG_FILE_PREV = 'app.log.1';       // one rotated generation is kept
const SESSION_FILE = 'logger-session.json';
const WATCHDOG_INTERVAL_MS = 2000;       // heartbeat / freeze-check cadence
const FREEZE_WARN_MS = 5000;             // gap beyond this ⇒ the JS thread stalled
const HEARTBEAT_PERSIST_EVERY = 5;       // persist session every Nth tick (~10s)
const LIVE_FORWARD_URL = 'http://localhost:8765/logs';

// ─── In-memory buffer + subscribers ───────────────────────────────────────────
let nextId = 1;
const entries: LogEntry[] = [];
const listeners: (() => void)[] = [];

function notify() { listeners.forEach(fn => fn()); }

export function getLogEntries(): LogEntry[] { return entries; }
export function clearLogEntries() { entries.splice(0, entries.length); notify(); }
export function subscribeToLogs(fn: () => void): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
}

// ─── Structured context ───────────────────────────────────────────────────────
// Ambient fields attached to every entry — e.g. { screen, audioFileId, appState }.
let context: Record<string, string | number | boolean> = {};
function setContext(patch: Record<string, string | number | boolean>) { Object.assign(context, patch); }
function clearContext(keys?: string[]) {
  if (!keys) context = {};
  else for (const k of keys) delete context[k];
}

// ─── File persistence (with rotation) ─────────────────────────────────────────
function logUri(): string | null {
  return FS.documentDirectory ? FS.documentDirectory + LOG_FILE : null;
}
function prevUri(): string | null {
  return FS.documentDirectory ? FS.documentDirectory + LOG_FILE_PREV : null;
}

export function getLogFilePath(): string { return logUri() ?? ''; }

let fileBytes = 0;
let fileSeeded = false;
async function seedFileSize() {
  fileSeeded = true;
  const uri = logUri();
  if (!uri) return;
  try {
    const info = await FS.getInfoAsync(uri);
    fileBytes = info.exists && 'size' in info ? (info.size ?? 0) : 0;
  } catch { fileBytes = 0; }
}

// Serialize writes so concurrent appends don't interleave or race rotation.
let writeQueue: Promise<void> = Promise.resolve();
function appendToFile(line: string) {
  const uri = logUri();
  if (!uri) return;
  writeQueue = writeQueue.then(async () => {
    try {
      if (!fileSeeded) await seedFileSize();
      if (fileBytes > MAX_FILE_BYTES) {
        const prev = prevUri();
        if (prev) {
          try { await FS.deleteAsync(prev, { idempotent: true }); } catch {}
          try { await FS.moveAsync({ from: uri, to: prev }); } catch {}
        }
        fileBytes = 0;
      }
      await FS.writeAsStringAsync(uri, line + '\n', { encoding: FS.EncodingType.UTF8, append: true });
      fileBytes += line.length + 1;
    } catch { /* best-effort */ }
  });
}

export function clearLogFile(): void {
  const uri = logUri(), prev = prevUri();
  writeQueue = writeQueue.then(async () => {
    if (uri) { try { await FS.deleteAsync(uri, { idempotent: true }); } catch {} }
    if (prev) { try { await FS.deleteAsync(prev, { idempotent: true }); } catch {} }
    fileBytes = 0;
  });
}

// ─── Live forward to the laptop log server (crash-proof, bypasses logcat) ─────
// Each line is POSTed the instant it's emitted, so it reaches the laptop even if
// the app is killed milliseconds later. Off by default (one fetch per line);
// toggle from the Log Viewer when actively debugging with `node log-server.js`.
let liveForward = false;
export function setLiveForward(on: boolean) { liveForward = on; }
export function isLiveForwardEnabled(): boolean { return liveForward; }
function forward(line: string) {
  if (!liveForward || typeof fetch === 'undefined') return;
  try { void fetch(LIVE_FORWARD_URL, { method: 'POST', body: line }).catch(() => {}); } catch {}
}

// ─── Session lifecycle + abnormal-exit detection ──────────────────────────────
interface SessionState {
  id: string;
  startedAt: number;
  lastHeartbeat: number;
  appState: string;          // 'active' | 'background' | 'inactive'
  crashed: boolean;          // set by the global JS error handler
  lastError?: string;
  lastBreadcrumb?: string;   // most recent lifecycle/nav breadcrumb
}

let session: SessionState = {
  id: 'pre-init', startedAt: Date.now(), lastHeartbeat: Date.now(),
  appState: 'active', crashed: false,
};

function sessionUri(): string | null {
  return FS.documentDirectory ? FS.documentDirectory + SESSION_FILE : null;
}
function persistSession() {
  const uri = sessionUri();
  if (!uri) return;
  // Fire-and-forget; the appState field is the reliable signal even if a crash
  // interrupts this write (a foreground death ⇒ appState was 'active').
  try {
    void FS.writeAsStringAsync(uri, JSON.stringify(session), { encoding: FS.EncodingType.UTF8 }).catch(() => {});
  } catch {}
}

function fmtTime(ts: number): string {
  try { return new Date(ts).toISOString().slice(11, 19); } catch { return String(ts); }
}

async function reportPreviousSession() {
  const uri = sessionUri();
  if (!uri) return;
  try {
    const info = await FS.getInfoAsync(uri);
    if (!info.exists) return;
    const prev = JSON.parse(await FS.readAsStringAsync(uri)) as SessionState;
    const when = fmtTime(prev.lastHeartbeat);
    const where = prev.lastBreadcrumb ? `, 最后动作: ${prev.lastBreadcrumb}` : '';
    if (prev.crashed) {
      emit('ERROR', 'session', `⚠ 上次会话因 JS 异常崩溃: ${prev.lastError ?? 'unknown'} (存活至 ${when}${where})`);
    } else if (prev.appState === 'active') {
      emit('WARN', 'session', `⚠ 上次会话在前台异常结束 — 疑似 ANR / 原生崩溃 / 被系统杀死 (存活至 ${when}${where})`);
    } else {
      emit('DEBUG', 'session', `上次会话在后台正常结束 (存活至 ${when})`);
    }
  } catch { /* unreadable previous session — ignore */ }
}

function startNewSession() {
  session = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt: Date.now(),
    lastHeartbeat: Date.now(),
    appState: (AppState.currentState as string) ?? 'active',
    crashed: false,
  };
  persistSession();
  emit('INFO', 'session', `会话开始 ${session.id} · ${Platform.OS}`);
}

// ─── Freeze watchdog + heartbeat ──────────────────────────────────────────────
let lastTick = Date.now();
let tickCount = 0;
let watchdogStarted = false;
function startWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;
  lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    // A healthy interval fires every ~WATCHDOG_INTERVAL_MS. A much larger gap
    // means the JS thread was blocked that long — exactly the unlock freeze.
    if (gap > FREEZE_WARN_MS) {
      emit('WARN', 'watchdog', `JS 主线程卡顿约 ${(gap / 1000).toFixed(1)}s（期望 ${WATCHDOG_INTERVAL_MS / 1000}s）`);
    }
    session.lastHeartbeat = now;
    if (++tickCount % HEARTBEAT_PERSIST_EVERY === 0) persistSession();
  }, WATCHDOG_INTERVAL_MS);
}

// ─── Global JS error handler ──────────────────────────────────────────────────
let handlerInstalled = false;
function installGlobalHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const EU = g.ErrorUtils;
  if (!EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler?.();
  EU.setGlobalHandler((err: unknown, isFatal?: boolean) => {
    try {
      const e = err as Error;
      emit('ERROR', 'crash', `${isFatal ? 'FATAL ' : ''}未捕获异常: ${e?.message ?? String(err)}`, err);
      session.crashed = true;
      session.lastError = e?.message ?? String(err);
      persistSession();
    } catch { /* never let logging mask the original error */ }
    prev?.(err, isFatal);
  });
}

// ─── Init (call once at app startup, as early as possible) ────────────────────
let initialized = false;
export async function initLogger(): Promise<void> {
  if (initialized) return;
  initialized = true;
  setContext({ platform: Platform.OS });
  installGlobalHandler();
  startWatchdog();
  // Lifecycle breadcrumbs + keep the session's appState current so an abnormal
  // exit can be classified (foreground death ⇒ crash/ANR; background ⇒ normal).
  AppState.addEventListener('change', s => {
    session.appState = s as string;
    session.lastBreadcrumb = `app→${s}`;
    persistSession();
    emit('DEBUG', 'lifecycle', `app → ${s}`);
  });
  await reportPreviousSession();
  startNewSession();
}

// ─── Core emit ────────────────────────────────────────────────────────────────
function emit(level: Level, tag: string, message: string, extra?: unknown) {
  const now = new Date();
  const time = now.toISOString().slice(11, 23); // HH:MM:SS.mmm

  let detail: string | undefined;
  if (extra instanceof Error) detail = extra.stack ?? extra.message;
  else if (extra !== undefined) detail = typeof extra === 'object' ? safeStringify(extra) : String(extra);

  const ctx = Object.keys(context).length ? { ...context } : undefined;
  const entry: LogEntry = { id: nextId++, time, level, tag, message, detail, context: ctx };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  notify();

  const ctxStr = ctx ? ' ' + compactContext(ctx) : '';
  const prefix = `[${time}][${level}][${tag}]${ctxStr}`;
  const full = detail ? `${prefix} ${message}\n${detail}` : `${prefix} ${message}`;
  if (level === 'ERROR') console.error(full);
  else if (level === 'WARN') console.warn(full);
  else console.log(full);
  appendToFile(full);
  forward(full);
}

function compactContext(ctx: Record<string, string | number | boolean>): string {
  return '{' + Object.entries(ctx).map(([k, v]) => `${k}=${v}`).join(' ') + '}';
}
function safeStringify(o: unknown): string {
  try { return JSON.stringify(o, null, 2); } catch { return String(o); }
}

export const log = {
  debug: (tag: string, msg: string, extra?: unknown) => emit('DEBUG', tag, msg, extra),
  info:  (tag: string, msg: string, extra?: unknown) => emit('INFO',  tag, msg, extra),
  warn:  (tag: string, msg: string, extra?: unknown) => emit('WARN',  tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => emit('ERROR', tag, msg, extra),
  setContext,
  clearContext,
  /** Record a breadcrumb (also stored in the session for crash reports). */
  breadcrumb: (msg: string) => { session.lastBreadcrumb = msg; emit('DEBUG', 'crumb', msg); },
};
