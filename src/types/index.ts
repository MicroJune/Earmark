// ─── Audio File ───────────────────────────────────────────────────────────────

export type AudioFileStatus = 'pending' | 'transcribing' | 'ready' | 'error';

export interface AudioFile {
  id: number;
  title: string;
  uri: string;           // local file path on device
  duration: number;      // seconds
  dateAdded: number;     // unix timestamp (ms)
  status: AudioFileStatus;
  phraseCount: number;
  errorMessage?: string; // populated when status === 'error'
  categoryId: number | null; // null = uncategorized
  lastPosition: number;  // seconds — where the user stopped listening
  sortOrder: number | null; // manual position within its category; null = unplaced
}

// ─── Categories ───────────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name: string;
  dateAdded: number; // unix timestamp (ms)
}

// ─── Transcript ───────────────────────────────────────────────────────────────

export interface Segment {
  id: number;
  audioFileId: number;
  segmentIndex: number;  // order in transcript
  text: string;          // full sentence text
  start: number;         // seconds
  end: number;           // seconds
  wordStartIndex: number; // first word's global index in the words array
  wordEndIndex: number;   // last word's global index
}

export interface Word {
  id: number;
  audioFileId: number;
  wordIndex: number;     // global position in full transcript
  segmentId: number;
  word: string;
  start: number;         // seconds
  end: number;           // seconds
}

// ─── Runtime Transcript (in-memory only, not persisted) ───────────────────────

export interface LoadedTranscript {
  audioFileId: number;
  words: Word[];
  segments: Segment[];
  wordStartTimes: Float64Array; // pre-computed from words[i].start for O(log n) binary search
}

// ─── Saved Items ──────────────────────────────────────────────────────────────

export type SavedItemType = 'word' | 'phrase' | 'sentence';
export type MasteryLevel = 'new' | 'learning' | 'mastered';

export interface SavedItem {
  id: number;
  audioFileId: number | null; // null = source audio file was deleted
  text: string;            // the saved word / phrase / sentence
  contextSentence: string; // full surrounding sentence for display
  startTime: number;       // seconds — for audio playback during review
  endTime: number;         // seconds
  type: SavedItemType;
  mastery: MasteryLevel;
  dateAdded: number;       // unix timestamp (ms)
  nextReview: number | null; // unix timestamp (ms) for spaced repetition; null = not scheduled
  enrichment: ItemEnrichment | null; // AI learning notes, generated once and cached
  note: string | null;               // user's personal memory note / mnemonic
  clipUri: string | null;  // extracted audio excerpt — survives source file deletion
  sourceTitle: string | null; // denormalized source file title — outlives the file row
  // SM-2 spaced-repetition state
  easeFactor: number;      // difficulty multiplier (starts 2.5, min 1.3)
  intervalDays: number;    // current scheduling interval in days
  reviewCount: number;     // number of successful reviews so far
}

// ─── Spaced repetition ────────────────────────────────────────────────────────

// 4-grade self-rating, SM-2 style. Maps to the buttons on a flashcard and is
// derived automatically from correctness in the typed/multiple-choice modes.
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface SrsState {
  easeFactor: number;
  intervalDays: number;
  reviewCount: number;
  nextReview: number;   // unix ms
  mastery: MasteryLevel; // derived from intervalDays, for display/filtering
}

// ─── Learning enrichment (AI-generated once per item, cached in SQLite) ───────

export interface EnrichmentExample {
  en: string; // example sentence in English
  zh: string; // Chinese translation of the example
}

export interface ItemEnrichment {
  translationZh: string;         // Chinese translation of the saved text
  definitionEn: string;          // simple English explanation
  synonyms: string[];            // similar words / phrases
  examples: EnrichmentExample[]; // additional example sentences
  tip?: string;                  // usage note or memory hook
}

// ─── Playback ─────────────────────────────────────────────────────────────────

export type PlaybackRate = 0.75 | 1 | 1.25 | 1.5;

export interface PlaybackStatus {
  isPlaying: boolean;
  currentPosition: number; // seconds
  duration: number;        // seconds
  playbackRate: PlaybackRate;
}

// ─── Review ───────────────────────────────────────────────────────────────────

export type ReviewMode = 'flashcard' | 'fill-in-blank' | 'listen-identify';

// One queued review: the item plus the mode chosen for it (interleaved mix).
export interface ReviewCard {
  item: SavedItem;
  mode: ReviewMode;
  // In-session relearning: a card answered 'again' is requeued to the end so the
  // user re-tests it before leaving. `relearns` caps the requeues; `isRelearn`
  // marks a requeued copy (shown with a "再练一次" badge, excluded from tally).
  relearns?: number;
  isRelearn?: boolean;
}

export interface ReviewSession {
  queue: ReviewCard[];     // items + their per-item mode for this session
  currentIndex: number;
  correctCount: number;    // graded 'good'/'easy'
  incorrectCount: number;  // graded 'again'/'hard'
}

// ─── AI Suggestions ───────────────────────────────────────────────────────────

export interface PhraseSuggestion {
  text: string;
  contextSentence: string;
  startTime: number;
  endTime: number;
  reason: string;          // why the AI thinks this phrase is worth learning
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export type RootTabParamList = {
  Home: undefined;
  Library: undefined;
  Review: undefined;
};

export type HomeStackParamList = {
  HomeScreen: undefined;
  // categoryId null = the built-in "Uncategorized" group
  CategoryView: { categoryId: number | null; categoryName: string };
  ContentView: { audioFileId: number };
};

// ─── API ──────────────────────────────────────────────────────────────────────

export interface TranscriptionResult {
  segments: Omit<Segment, 'id' | 'audioFileId'>[];
  words: Omit<Word, 'id' | 'audioFileId'>[];
}

export interface AppConfig {
  volcApiKey: string;
  arkApiKey: string;
  deepseekApiKey: string;
}
