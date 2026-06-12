import { File, Paths } from 'expo-file-system';
import { writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: number;
  time: string;
  level: Level;
  tag: string;
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 300;
let nextId = 1;
const entries: LogEntry[] = [];
const listeners: (() => void)[] = [];

// Write logs to a file in the app documents dir so they can be pulled via adb
let logFile: File | null = null;
function getLogFile(): File {
  if (!logFile) logFile = new File(Paths.document, 'app.log');
  return logFile;
}
export function getLogFilePath(): string {
  return getLogFile().uri;
}
export function clearLogFile(): void {
  const f = getLogFile();
  if (f.exists) f.delete();
}

let writeQueue = Promise.resolve();
function appendToFile(line: string) {
  writeQueue = writeQueue.then(async () => {
    try {
      await writeAsStringAsync(getLogFile().uri, line + '\n', {
        encoding: EncodingType.UTF8,
        append: true,
      });
    } catch (_) {}
  });
}

function notify() {
  listeners.forEach(fn => fn());
}

export function getLogEntries(): LogEntry[] {
  return entries;
}

export function clearLogEntries() {
  entries.splice(0, entries.length);
  notify();
}

export function subscribeToLogs(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i !== -1) listeners.splice(i, 1);
  };
}

function emit(level: Level, tag: string, message: string, extra?: unknown) {
  const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

  let detail: string | undefined;
  if (extra instanceof Error) {
    detail = extra.stack ?? extra.message;
  } else if (extra !== undefined) {
    detail = typeof extra === 'object' ? JSON.stringify(extra, null, 2) : String(extra);
  }

  const entry: LogEntry = { id: nextId++, time, level, tag, message, detail };

  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  notify();

  // Forward to Metro console and persist to file
  const prefix = `[${time}][${level}][${tag}]`;
  const full = detail ? `${prefix} ${message}\n${detail}` : `${prefix} ${message}`;
  if (level === 'ERROR') console.error(full);
  else if (level === 'WARN') console.warn(full);
  else console.log(full);
  appendToFile(full);
}

export const log = {
  debug: (tag: string, msg: string, extra?: unknown) => emit('DEBUG', tag, msg, extra),
  info:  (tag: string, msg: string, extra?: unknown) => emit('INFO',  tag, msg, extra),
  warn:  (tag: string, msg: string, extra?: unknown) => emit('WARN',  tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => emit('ERROR', tag, msg, extra),
};
