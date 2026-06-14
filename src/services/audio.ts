import {
  createAudioPlayer,
  setAudioModeAsync,
  requestNotificationPermissionsAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { Platform } from 'react-native';
import type { EventSubscription } from 'expo-modules-core';
import type { PlaybackRate, SavedItem } from '../types';
import { usePlaybackStore } from '../store/playbackStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { usePreviewStore } from '../store/previewStore';
import { updateAudioFilePosition, getAudioFile } from '../db/queries/audioFiles';
import { findSentenceBounds } from './sentenceLocator';
import { log } from '../utils/logger';

// ─── Singleton sound instance ─────────────────────────────────────────────────
// Only one audio file plays at a time. A new loadAudio() call unloads the previous one.

let _player: AudioPlayer | null = null;
let _statusSubscription: EventSubscription | null = null;
let _activeAudioFileId: number | null = null;
let _durationPersisted = false;
let _lastPersistedPosition = 0;

// TEMP DIAGNOSTIC (problem 1): detect bursts of playbackStatusUpdate callbacks.
// Normal cadence is ~100ms (updateInterval). If on unlock we see many callbacks
// arriving <60ms apart, the native layer is draining a backlog → confirms the
// "catch-up flood" theory. Logged only when a burst ends, so it's quiet during
// normal playback.
let _lastStatusWall = 0;
let _burstCount = 0;
let _burstStartWall = 0;
let _burstStartPos = 0;

// How often (seconds of playback) the position is checkpointed to the DB.
// Crash-safety only — the authoritative write happens in unloadAudio().
const POSITION_CHECKPOINT_INTERVAL = 5;

// ─── Error ────────────────────────────────────────────────────────────────────

export class AudioServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioServiceError';
  }
}

// ─── Audio mode ───────────────────────────────────────────────────────────────

/**
 * Must be called once at app startup (before any audio is loaded).
 * Enables playback in silent mode and background audio.
 */
export async function setupAudioMode(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    // expo-audio requires 'doNotMix' for setActiveForLockScreen (media
    // notification / lock-screen controls) to work. It also pauses other
    // apps' audio when playback starts — appropriate for podcasts.
    interruptionMode: 'doNotMix',
  });
}

// ─── Playback status handler ──────────────────────────────────────────────────

function persistDurationOnce(status: AudioStatus): void {
  if (_durationPersisted || !_activeAudioFileId || status.duration <= 0) return;

  _durationPersisted = true;
  void useAudioFilesStore
    .getState()
    .updateDuration(_activeAudioFileId, status.duration);
}

function checkpointPosition(positionSeconds: number): void {
  if (!_activeAudioFileId) return;
  if (Math.abs(positionSeconds - _lastPersistedPosition) < POSITION_CHECKPOINT_INTERVAL) return;
  _lastPersistedPosition = positionSeconds;
  void updateAudioFilePosition(_activeAudioFileId, positionSeconds).catch(() => {});
}

function handlePlaybackStatus(status: AudioStatus): void {
  if (!status.isLoaded) return;

  const positionSeconds = status.currentTime;
  const store = usePlaybackStore.getState();

  // TEMP DIAGNOSTIC (problem 1): burst detector.
  {
    const nowWall = Date.now();
    const gap = _lastStatusWall === 0 ? 9999 : nowWall - _lastStatusWall;
    _lastStatusWall = nowWall;
    if (gap < 60) {
      if (_burstCount === 0) { _burstStartWall = nowWall; _burstStartPos = positionSeconds; }
      _burstCount++;
    } else {
      if (_burstCount >= 3) {
        log.warn('diag-p1', `status BURST: ${_burstCount} updates in ${nowWall - _burstStartWall}ms, pos ${_burstStartPos.toFixed(1)}s→${positionSeconds.toFixed(1)}s (Δ${(positionSeconds - _burstStartPos).toFixed(1)}s)`);
      }
      _burstCount = 0;
    }
  }

  persistDurationOnce(status);
  store.setPosition(positionSeconds);
  store.setIsPlaying(status.playing);
  checkpointPosition(positionSeconds);

  // Loop segment: when position reaches segment end, jump back to start
  if (store.loopSegment && positionSeconds >= store.loopSegment.end) {
    void seekTo(store.loopSegment.start);
    return;
  }

  // End of file
  if (status.didJustFinish) {
    const mode = usePlaybackStore.getState().repeatMode;
    if (mode === 'one') {
      // Loop this file — restart from the top, keep playing
      void seekTo(0).then(() => _player?.play());
      return;
    }
    if (mode === 'all') {
      // Sequential: advancing to the next file is a navigation/loading concern,
      // handled by the Content View via this hook (it unloads + persists).
      store.setIsPlaying(false);
      _onTrackEnd?.();
      return;
    }
    // 'off' — stop and rewind to the start so the seek bar returns to 0 and the
    // next tap on play restarts from the top (instead of replaying from the
    // stuck end position).
    store.setIsPlaying(false);
    store.setPosition(0);
    void seekTo(0);
    if (_activeAudioFileId) {
      _lastPersistedPosition = 0;
      void updateAudioFilePosition(_activeAudioFileId, 0).catch(() => {});
    }
  }
}

// Registered by the Content View so 'all' (sequential) playback can advance to
// the next file in the category when the current one ends.
let _onTrackEnd: (() => void) | null = null;
export function setOnTrackEnd(fn: (() => void) | null): void {
  _onTrackEnd = fn;
}

// ─── Load / unload ────────────────────────────────────────────────────────────

// Android 13+ needs the POST_NOTIFICATIONS permission for the media-controls
// notification. Ask once per app run; playback works without it — only the
// notification shade controls would be missing.
let _notificationPermissionRequested = false;
function ensureNotificationPermission(): void {
  if (_notificationPermissionRequested || Platform.OS !== 'android') return;
  _notificationPermissionRequested = true;
  void requestNotificationPermissionsAsync()
    .then(r => log.debug('audio', `notification permission: granted=${r.granted} status=${r.status} canAskAgain=${r.canAskAgain}`))
    .catch(e => log.warn('audio', 'notification permission request failed', e instanceof Error ? e.message : String(e)));
}

/**
 * Loads an audio file. Unloads any previously loaded file first.
 * Persists the audio duration to the DB if not already saved.
 * Registers the player on the lock screen so playback continues (and stays
 * controllable) with the screen off — for passive listening practice.
 */
export async function loadAudio(
  uri: string,
  audioFileId: number,
  title?: string
): Promise<void> {
  await unloadAudio();

  try {
    const player = createAudioPlayer(
      { uri },
      {
        updateInterval: 100,   // milliseconds — 10 status updates/sec for word-level sync
      }
    );

    _player = player;
    _activeAudioFileId = audioFileId;
    _durationPersisted = false;
    _lastPersistedPosition = 0;
    _statusSubscription = player.addListener('playbackStatusUpdate', handlePlaybackStatus);
    handlePlaybackStatus(player.currentStatus);

    // Lock-screen / notification media controls (best-effort — in-app
    // playback works even if this fails on some device/launcher)
    ensureNotificationPermission();
    try {
      player.setActiveForLockScreen(
        true,
        { title: title ?? 'Podcast', artist: 'Earmark' },
        { showSeekForward: true, showSeekBackward: true }
      );
    } catch (e) {
      log.warn('audio', 'setActiveForLockScreen FAILED', e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    throw new AudioServiceError(
      `Failed to load audio: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Unloads the current sound and releases native resources.
 * Call this when navigating away from the content view.
 */
export async function unloadAudio(): Promise<void> {
  if (!_player) return;
  const fileId = _activeAudioFileId;
  const finalPosition = usePlaybackStore.getState().currentPosition;
  try {
    _statusSubscription?.remove();
    try { _player.clearLockScreenControls(); } catch {}
    // pause() BEFORE remove() — same Android quirk as stopPreview()
    try { _player.pause(); } catch {}
    _player.remove();
  } finally {
    _player = null;
    _statusSubscription = null;
    _activeAudioFileId = null;
    _durationPersisted = false;
    _lastPersistedPosition = 0;
  }
  // Authoritative position write + store refresh so file cards show progress.
  if (fileId !== null) {
    try {
      await updateAudioFilePosition(fileId, finalPosition);
      await useAudioFilesStore.getState().refreshAudioFile(fileId);
    } catch {}
  }
}

// ─── Playback controls ────────────────────────────────────────────────────────

export async function play(): Promise<void> {
  stopPreview(); // main playback and clip previews never play at once
  _player?.play();
}

export async function pause(): Promise<void> {
  _player?.pause();
}

export async function togglePlayPause(): Promise<void> {
  const { isPlaying } = usePlaybackStore.getState();
  if (isPlaying) await pause();
  else await play();
}

/**
 * Seeks to a position in seconds.
 * Safe to call even when paused — position updates immediately.
 */
export async function seekTo(seconds: number): Promise<void> {
  await _player?.seekTo(Math.max(0, seconds));
}

/**
 * Seeks to a specific word by index.
 * Optimistically updates the store highlight before the audio catches up.
 */
export async function seekToWord(wordIndex: number): Promise<void> {
  const { transcript } = usePlaybackStore.getState();
  if (!transcript) return;

  const word = transcript.words[wordIndex];
  if (!word) return;

  usePlaybackStore.getState().seekToWord(wordIndex);
  await seekTo(word.start);
}

/**
 * Sets the playback rate. Pitch correction is always enabled so voices
 * don't sound unnatural at 0.75x or 1.5x.
 */
export async function setPlaybackRate(rate: PlaybackRate): Promise<void> {
  _player?.setPlaybackRate(rate, 'medium');
  usePlaybackStore.getState().setPlaybackRate(rate);
}

/**
 * Skips forward or backward by a given number of seconds.
 * Useful for 10-second skip buttons.
 */
export async function skip(seconds: number): Promise<void> {
  const { currentPosition } = usePlaybackStore.getState();
  await seekTo(currentPosition + seconds);
}

// ─── State queries ────────────────────────────────────────────────────────────

export function isLoaded(): boolean {
  return _player !== null;
}

// ─── Preview playback (Library detail + Review modes) ─────────────────────────
// A "preview" is a short [start,end] excerpt. Only ONE preview plays at a time,
// and starting one pauses the main transcript player — the two never overlap.
// State lives in usePreviewStore so buttons can show a play/pause icon and a
// second tap on the same button pauses (rather than starting a second sound).

// A clip should never play longer than this. Guards against bad timestamps
// (e.g. a wrong unit) that would otherwise play most of the file.
const MAX_CLIP_SECONDS = 30;

let _clipPlayer: AudioPlayer | null = null;
let _clipSubscription: EventSubscription | null = null;
let _clipTimeout: ReturnType<typeof setTimeout> | null = null;

function setPreviewState(key: string | null, status: 'idle' | 'loading' | 'playing' | 'paused') {
  usePreviewStore.getState().set(key, status);
}

/** Stops and releases the preview player and resets preview UI state. */
export function stopPreview(): void {
  if (_clipTimeout) { clearTimeout(_clipTimeout); _clipTimeout = null; }
  _clipSubscription?.remove();
  _clipSubscription = null;
  // pause() BEFORE remove(): on Android, releasing a playing player can leave
  // the sound running with no handle to control it.
  try { _clipPlayer?.pause(); } catch {}
  _clipPlayer?.remove();
  _clipPlayer = null;
  setPreviewState(null, 'idle');
}

/**
 * Toggles a bounded [start,end] preview clip identified by `key`:
 *   - same key currently playing → pause
 *   - same key currently paused  → resume
 *   - any other state            → stop whatever's playing (incl. main) and
 *                                   start this clip from `start`
 */
export function togglePreview(key: string, uri: string, start: number, end: number): void {
  const { activeKey, status } = usePreviewStore.getState();

  // Toggling the currently-active button
  if (activeKey === key && _clipPlayer) {
    if (status === 'playing') {
      _clipPlayer.pause();
      setPreviewState(key, 'paused');
    } else if (status === 'paused') {
      _clipPlayer.play();
      setPreviewState(key, 'playing');
    }
    return;
  }

  // Starting a new preview — tear down any previous preview and pause main
  stopPreview();
  _player?.pause();

  const safeStart = Math.max(0, start);
  let safeEnd = end;
  if (!(safeEnd > safeStart)) safeEnd = safeStart + 3; // bad bounds fallback
  if (safeEnd - safeStart > MAX_CLIP_SECONDS) {
    log.warn('audio', `clip bounds too long (${safeStart.toFixed(1)}–${safeEnd.toFixed(1)}s) — clamping to ${MAX_CLIP_SECONDS}s. Likely a timestamp issue.`);
    safeEnd = safeStart + MAX_CLIP_SECONDS;
  }
  log.debug('audio', `preview ${key} start: requested ${start.toFixed(2)}–${end.toFixed(2)}s → playing ${safeStart.toFixed(2)}–${safeEnd.toFixed(2)}s of ${uri.split('/').pop()}`);

  try {
    const player = createAudioPlayer({ uri }, { updateInterval: 50 });
    _clipPlayer = player;
    setPreviewState(key, 'loading');

    let started = false;
    _clipSubscription = player.addListener('playbackStatusUpdate', (s: AudioStatus) => {
      if (!s.isLoaded || !started) return;
      if (s.didJustFinish || s.currentTime >= safeEnd) {
        stopPreview();
      }
    });

    // CRITICAL: seekTo() before the source finishes loading is silently
    // ignored — playback would start at 0:00 (the podcast intro). Wait for
    // the player to report loaded, THEN seek, THEN play.
    void (async () => {
      let loaded = false;
      for (let i = 0; i < 100; i++) { // up to ~5s
        if (_clipPlayer !== player) return; // superseded
        if (player.currentStatus.isLoaded) { loaded = true; break; }
        await new Promise(r => setTimeout(r, 50));
      }
      if (_clipPlayer !== player) return;
      if (!loaded) {
        log.warn('audio', 'preview source never loaded — giving up');
        stopPreview();
        return;
      }
      await player.seekTo(safeStart);
      if (_clipPlayer !== player) return;
      started = true;
      player.play();
      setPreviewState(key, 'playing');
      // Safety net armed only once playback actually starts
      _clipTimeout = setTimeout(stopPreview, (safeEnd - safeStart) * 1000 + 2000);
    })().catch(() => stopPreview());
  } catch (e) {
    stopPreview();
    throw new AudioServiceError(
      `Failed to play clip: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Toggles the original-audio preview for a saved item. Prefers the item's
 * extracted clip file (survives source deletion); falls back to the source
 * file sliced to [start,end]. Throws when neither is available.
 */
export async function toggleSavedItemPreview(
  key: string,
  item: Pick<SavedItem, 'clipUri' | 'audioFileId' | 'startTime' | 'endTime' | 'contextSentence' | 'text'>
): Promise<void> {
  // If toggling the active button, no need to resolve the source again.
  if (usePreviewStore.getState().activeKey === key && _clipPlayer) {
    togglePreview(key, '', 0, 0); // uri/bounds ignored on toggle path
    return;
  }
  log.debug('audio', `preview ${key}: text="${item.text}" context="${item.contextSentence?.slice(0, 60)}" storedTimes=${item.startTime?.toFixed?.(2)}–${item.endTime?.toFixed?.(2)}s clipUri=${item.clipUri ? 'yes' : 'no'} audioFileId=${item.audioFileId}`);

  // Best source: locate the "From the podcast" sentence by TEXT in the
  // transcript — guaranteed to play exactly what the user sees, regardless
  // of whether the item's stored timestamps are trustworthy.
  if (item.audioFileId !== null) {
    const file = await getAudioFile(item.audioFileId);
    if (file) {
      const bounds = await findSentenceBounds(item.audioFileId, item.contextSentence)
        .catch(() => null);
      const start = bounds ? bounds.start : item.startTime;
      const end = bounds ? bounds.end : item.endTime;
      if (!bounds) {
        log.warn('audio', `sentence NOT found in transcript — falling back to stored item times ${item.startTime?.toFixed?.(2)}–${item.endTime?.toFixed?.(2)}s (these may be wrong)`);
      }
      log.debug('audio', `will play ${file.uri.split('/').pop()} @ ${Math.max(0, start - 0.3).toFixed(2)}–${(end + 0.4).toFixed(2)}s`);
      togglePreview(key, file.uri, Math.max(0, start - 0.3), end + 0.4);
      return;
    }
    log.warn('audio', `audioFileId=${item.audioFileId} not found in DB — file row missing`);
  }
  // Source file deleted — fall back to the extracted clip (phrase-only).
  if (item.clipUri) {
    log.debug('audio', `playing extracted clip ${item.clipUri.split('/').pop()}`);
    // Clip files already include pre/post padding — play them whole.
    togglePreview(key, item.clipUri, 0, item.endTime - item.startTime + 1);
    return;
  }
  throw new AudioServiceError('The source audio is no longer available.');
}
