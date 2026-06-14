import { create } from 'zustand';
import type { SavedItem, ReviewMode, ReviewCard, ReviewSession, ReviewGrade } from '../types';
import { getDueForReview } from '../db/queries/savedItems';
import { logReview } from '../db/queries/reviewLog';
import { useLibraryStore } from './libraryStore';
import { computeSrs, shuffle } from '../utils/spacedRepetition';

// ─── Per-item mode assignment (interleaving + desirable difficulty) ───────────
// The review mode is chosen per item from its mastery, so harder retrieval is
// asked of better-known items, and a single session interleaves all modes:
//   new      → recognition (flashcard or listen-identify)
//   learning → listen-identify (multiple choice)
//   mastered → fill-in-blank (production / typing — hardest)
// Items without a usable audio clip can't do listen-identify, so they fall
// back to flashcard.
function pickMode(item: SavedItem, index: number): ReviewMode {
  const hasAudio = item.clipUri !== null || item.audioFileId !== null;
  switch (item.mastery) {
    case 'mastered':
      return 'fill-in-blank';
    case 'learning':
      return hasAudio ? 'listen-identify' : 'fill-in-blank';
    case 'new':
    default:
      // Alternate within new items so it's not all flashcards.
      if (hasAudio && index % 2 === 1) return 'listen-identify';
      return 'flashcard';
  }
}

// Max times one item can be requeued for in-session relearning after 'again'.
const MAX_RELEARNS = 2;

function buildQueue(items: SavedItem[]): ReviewCard[] {
  return shuffle(items).map((item, i) => ({ item, mode: pickMode(item, i) }));
}

// Maps a graded answer to a correct/incorrect tally for session stats.
function isPositive(grade: ReviewGrade): boolean {
  return grade === 'good' || grade === 'easy';
}

interface ReviewStore {
  session: ReviewSession | null;
  isLoading: boolean;
  error: string | null;

  // Start a smart-mixed session. If items aren't provided, loads all due items.
  startSession: (items?: SavedItem[]) => Promise<void>;

  // Grade the current card (SM-2), persist, and advance.
  grade: (grade: ReviewGrade) => Promise<void>;

  skipItem: () => void;
  endSession: () => void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  session: null,
  isLoading: false,
  error: null,

  startSession: async (items) => {
    set({ isLoading: true, error: null });
    try {
      const source = items ?? (await getDueForReview());
      set({
        session: {
          queue: buildQueue(source),
          currentIndex: 0,
          correctCount: 0,
          incorrectCount: 0,
        },
      });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  grade: async (grade) => {
    const { session } = get();
    if (!session) return;
    const card = session.queue[session.currentIndex];
    if (!card) return;

    const srs = computeSrs(card.item, grade);
    await useLibraryStore.getState().applySrs(card.item.id, srs);
    void logReview(card.item.id, isPositive(grade));

    set(state => {
      if (!state.session) return {};
      const positive = isPositive(grade);

      // In-session relearning: a lapsed item ('again') goes back to the end of
      // the queue so it's re-tested before the session ends — the single most
      // effective short-term reinforcement after a miss. Capped at MAX_RELEARNS
      // so a persistently-failed item can't loop forever.
      const queue = [...state.session.queue];
      if (grade === 'again' && (card.relearns ?? 0) < MAX_RELEARNS) {
        queue.push({ ...card, relearns: (card.relearns ?? 0) + 1, isRelearn: true });
      }

      // Only the first encounter of an item counts toward the session tally, so
      // requeued relearns don't inflate the score.
      const counts = card.isRelearn
        ? {}
        : {
            correctCount: state.session.correctCount + (positive ? 1 : 0),
            incorrectCount: state.session.incorrectCount + (positive ? 0 : 1),
          };

      return {
        session: {
          ...state.session,
          queue,
          currentIndex: state.session.currentIndex + 1,
          ...counts,
        },
      };
    });
  },

  skipItem: () => {
    set(state => {
      if (!state.session) return {};
      return {
        session: { ...state.session, currentIndex: state.session.currentIndex + 1 },
      };
    });
  },

  endSession: () => set({ session: null }),
}));
