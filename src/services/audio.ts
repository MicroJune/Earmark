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
import { updateAudioFilePosition, getAudioFile } from '../db/queries/audioFiles';

// ─── Singleton sound instance ─────────────────────────────────────────────────
// Only one audio file plays at a time. A new loadAudio() call unloads the previous one.

let _player: AudioPlayer | null = null;
let _statusSubscription: EventSubscription | null = null;
let _activeAudioFileId: number | null = null;
let _durationPersisted = false;
let _lastPersistedPosition = 0;

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
    interruptionMode: 'duckOthers',
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

  persistDurationOnce(status);
  store.setPosition(positionSeconds);
  store.setIsPlaying(status.playing);
  checkpointPosition(positionSeconds);

  // Loop segment: when position reaches segment end, jump back to start
  if (store.loopSegment && positionSeconds >= store.loopSegment.end) {
    void seekTo(store.loopSegment.start);
    return;
  }

  // End of file — reset the saved position so next open starts from the top
  if (status.didJustFinish) {
    store.setIsPlaying(false);
    if (_activeAudioFileId) {
      _lastPersistedPosition = 0;
      void updateAudioFilePosition(_activeAudioFileId, 0).catch(() => {});
    }
  }
}

// ─── Load / unload ────────────────────────────────────────────────────────────

// Android 13+ needs the POST_NOTIFICATIONS permission for the media-controls
// notification. Ask once per app run; playback works without it — only the
// notification shade controls would be missing.
let _notificationPermissionRequested = false;
function ensureNotificationPermission(): void {
  if (_notificationPermissionRequested || Platform.OS !== 'android') return;
  _notificationPermissionRequested = true;
  void requestNotificationPermissionsAsync().catch(() => {});
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
        { title: title ?? 'Podcast', artist: 'Podcast Assistant' },
        { showSeekForward: true, showSeekBackward: true }
      );
    } catch {}
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

// ─── Clip playback (for review modes) ─────────────────────────────────────────
// Plays a short [start, end] excerpt of a file on a separate throwaway player,
// so it never interferes with the main transcript player.

let _clipPlayer: AudioPlayer | null = null;
let _clipSubscription: EventSubscription | null = null;

export function stopClip(): void {
  _clipSubscription?.remove();
  _clipSubscription = null;
  _clipPlayer?.remove();
  _clipPlayer = null;
}

/**
 * Plays the [start, end] excerpt of an audio file.
 * Resolves when the clip finishes (or is stopped by a newer clip).
 */
export async function playClip(uri: string, start: number, end: number): Promise<void> {
  stopClip();

  return new Promise<void>((resolve, reject) => {
    try {
      const player = createAudioPlayer({ uri }, { updateInterval: 50 }); // ms — fine-grained clip-end detection
      _clipPlayer = player;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stopClip();
        resolve();
      };

      _clipSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish || status.currentTime >= end) finish();
      });

      void player
        .seekTo(Math.max(0, start))
        .then(() => player.play())
        .catch(() => {
          finish();
        });

      // Safety net: never hang longer than the clip length + 5s
      const maxMs = Math.max(1000, (end - start) * 1000 + 5000);
      setTimeout(finish, maxMs);
    } catch (e) {
      stopClip();
      reject(new AudioServiceError(
        `Failed to play clip: ${e instanceof Error ? e.message : String(e)}`
      ));
    }
  });
}

/**
 * Plays the original audio for a saved item. Prefers the item's extracted
 * clip file (which survives source deletion); falls back to slicing the
 * source audio file. Throws when neither is available.
 */
export async function playSavedItemAudio(
  item: Pick<SavedItem, 'clipUri' | 'audioFileId' | 'startTime' | 'endTime'>
): Promise<void> {
  if (item.clipUri) {
    // Clip files already include pre/post padding — play them whole.
    await playClip(item.clipUri, 0, item.endTime - item.startTime + 1);
    return;
  }
  if (item.audioFileId !== null) {
    const file = await getAudioFile(item.audioFileId);
    if (file) {
      // Pad slightly so the phrase isn't cut off mid-word
      await playClip(file.uri, Math.max(0, item.startTime - 0.3), item.endTime + 0.4);
      return;
    }
  }
  throw new AudioServiceError('The source audio is no longer available.');
}
