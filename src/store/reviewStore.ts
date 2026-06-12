import { create } from 'zustand';
import type { SavedItem, ReviewMode, ReviewSession, MasteryLevel } from '../types';
import { getDueForReview } from '../db/queries/savedItems';
import { logReview } from '../db/queries/reviewLog';
import { useLibraryStore } from './libraryStore';
import { nextMastery, nextReviewAt, shuffle } from '../utils/spacedRepetition';

// ─── Store ────────────────────────────────────────────────────────────────────

interface ReviewStore {
  session: ReviewSession | null;
  isLoading: boolean;
  error: string | null;

  // Start a session. If items are not provided, loads all due items from DB.
  startSession: (mode: ReviewMode, items?: SavedItem[]) => Promise<void>;

  // Mark the current item correct or incorrect, advance to next item.
  // Updates mastery + schedules next review in DB via libraryStore.
  answerCorrect: () => Promise<void>;
  answerIncorrect: () => Promise<void>;

  skipItem: () => void;
  endSession: () => void;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  session: null,
  isLoading: false,
  error: null,

  startSession: async (mode, items) => {
    set({ isLoading: true, error: null });
    try {
      const queue = shuffle(items ?? (await getDueForReview()));
      set({
        session: {
          mode,
          queue,
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

  answerCorrect: async () => {
    const { session } = get();
    if (!session) return;

    const item = session.queue[session.currentIndex];
    if (!item) return;
    const newMastery = nextMastery(item.mastery, true);
    const nextReview = nextReviewAt(newMastery);

    await useLibraryStore.getState().updateMastery(item.id, newMastery);
    await useLibraryStore.getState().scheduleReview(item.id, nextReview);
    void logReview(item.id, true);

    set(state => {
      if (!state.session) return {};
      const currentIndex = state.session.currentIndex + 1;
      return {
        session: {
          ...state.session,
          currentIndex,
          correctCount: state.session.correctCount + 1,
        },
      };
    });
  },

  answerIncorrect: async () => {
    const { session } = get();
    if (!session) return;

    const item = session.queue[session.currentIndex];
    if (!item) return;
    const newMastery = nextMastery(item.mastery, false);
    const nextReview = nextReviewAt(newMastery);

    await useLibraryStore.getState().updateMastery(item.id, newMastery);
    await useLibraryStore.getState().scheduleReview(item.id, nextReview);
    void logReview(item.id, false);

    set(state => {
      if (!state.session) return {};
      const currentIndex = state.session.currentIndex + 1;
      return {
        session: {
          ...state.session,
          currentIndex,
          incorrectCount: state.session.incorrectCount + 1,
        },
      };
    });
  },

  skipItem: () => {
    set(state => {
      if (!state.session) return {};
      return {
        session: {
          ...state.session,
          currentIndex: state.session.currentIndex + 1,
        },
      };
    });
  },

  endSession: () => set({ session: null }),
}));
