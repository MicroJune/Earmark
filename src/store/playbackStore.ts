import { create } from 'zustand';
import type { LoadedTranscript, PlaybackRate, Segment } from '../types';

export type RepeatMode = 'off' | 'one' | 'all';
import { getWordsByAudioFile } from '../db/queries/words';
import { getSegmentsByAudioFile } from '../db/queries/segments';
import { findActiveWordIndex } from '../utils/binarySearch';
import { prepareDisplayTranscript } from '../utils/resegment';

function buildTranscript(
  audioFileId: number,
  words: Awaited<ReturnType<typeof getWordsByAudioFile>>,
  segments: Awaited<ReturnType<typeof getSegmentsByAudioFile>>
): LoadedTranscript {
  return {
    audioFileId,
    words,
    segments,
    wordStartTimes: new Float64Array(words.map(w => w.start)),
  };
}

interface PlaybackStore {
  // Loaded content
  activeAudioFileId: number | null;
  transcript: LoadedTranscript | null;

  // Playback state
  isPlaying: boolean;
  currentPosition: number;  // seconds
  activeWordIndex: number;  // -1 when nothing is active
  playbackRate: PlaybackRate;

  // Loop — double-tap a segment to loop it (for shadowing/pronunciation practice)
  loopSegment: Segment | null;

  // Repeat mode for whole-file playback:
  //   'off' — stop at end; 'one' — loop this file; 'all' — play next file in category
  repeatMode: RepeatMode;

  // Selection — tap/drag to select a range of words for saving
  selectionStart: number | null;  // word index (always <= selectionEnd)
  selectionEnd: number | null;    // word index
  selectionAnchor: number | null; // the word the selection started from

  // Actions
  loadTranscript: (audioFileId: number) => Promise<void>;
  unloadTranscript: () => void;
  setPosition: (position: number) => void;  // called by expo-audio every ~100ms
  setIsPlaying: (isPlaying: boolean) => void;
  seekToWord: (wordIndex: number) => void;  // optimistic: updates highlight before audio catches up
  setPlaybackRate: (rate: PlaybackRate) => void;
  setLoopSegment: (segment: Segment | null) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setSelection: (start: number, end: number) => void;
  extendSelection: (wordIndex: number) => void; // drag to extend from existing selectionStart
  clearSelection: () => void;
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  activeAudioFileId: null,
  transcript: null,
  isPlaying: false,
  currentPosition: 0,
  activeWordIndex: -1,
  playbackRate: 1,
  loopSegment: null,
  repeatMode: 'off',
  selectionStart: null,
  selectionEnd: null,
  selectionAnchor: null,

  loadTranscript: async (audioFileId) => {
    const [words, segments] = await Promise.all([
      getWordsByAudioFile(audioFileId),
      getSegmentsByAudioFile(audioFileId),
    ]);
    // Display sentence-level paragraphs (with punctuation restored onto the
    // words) rather than whisper's arbitrary ~30s chunks
    const display = prepareDisplayTranscript(audioFileId, words, segments);
    set({
      activeAudioFileId: audioFileId,
      transcript: buildTranscript(audioFileId, display.words, display.segments),
      currentPosition: 0,
      activeWordIndex: -1,
      isPlaying: false,
      loopSegment: null,
      selectionStart: null,
      selectionEnd: null,
      selectionAnchor: null,
    });
  },

  unloadTranscript: () => {
    set({
      activeAudioFileId: null,
      transcript: null,
      isPlaying: false,
      currentPosition: 0,
      activeWordIndex: -1,
      loopSegment: null,
      selectionStart: null,
      selectionEnd: null,
      selectionAnchor: null,
    });
  },

  setPosition: (position) => {
    const { transcript } = get();
    if (!transcript) return;
    set({
      currentPosition: position,
      activeWordIndex: findActiveWordIndex(transcript.wordStartTimes, position),
    });
  },

  setIsPlaying: (isPlaying) => set({ isPlaying }),

  seekToWord: (wordIndex) => {
    const { transcript } = get();
    if (!transcript) return;
    const word = transcript.words[wordIndex];
    if (!word) return;
    // Update highlight immediately — audio service will seek separately
    set({ activeWordIndex: wordIndex, currentPosition: word.start });
  },

  setPlaybackRate: (rate) => set({ playbackRate: rate }),

  setLoopSegment: (segment) => set({ loopSegment: segment }),

  setRepeatMode: (mode) => set({ repeatMode: mode }),

  setSelection: (start, end) => set({
    selectionStart: Math.min(start, end),
    selectionEnd: Math.max(start, end),
    selectionAnchor: start,
  }),

  extendSelection: (wordIndex) => {
    const { selectionAnchor } = get();
    if (selectionAnchor === null) {
      set({ selectionStart: wordIndex, selectionEnd: wordIndex, selectionAnchor: wordIndex });
      return;
    }
    // Extend relative to the anchor so the originally selected word always
    // stays inside the selection, whichever direction the user taps.
    set({
      selectionStart: Math.min(selectionAnchor, wordIndex),
      selectionEnd: Math.max(selectionAnchor, wordIndex),
    });
  },

  clearSelection: () => set({ selectionStart: null, selectionEnd: null, selectionAnchor: null }),
}));
