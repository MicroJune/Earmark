import { create } from 'zustand';
import type { SavedItem, SavedItemType, MasteryLevel, SrsState } from '../types';
import {
  getAllSavedItems,
  insertSavedItem,
  deleteSavedItem,
  updateMastery,
  updateNextReview,
  updateEnrichment,
  updateSavedItemText,
  updateNote,
  updateSrsState,
  searchSavedItems,
} from '../db/queries/savedItems';
import { generateEnrichment } from '../services/enrichment';
import { getSettings } from '../services/settings';
import { deleteClipFile } from '../services/clips';
import {
  incrementPhraseCount,
  decrementPhraseCount,
} from '../db/queries/audioFiles';
import { useAudioFilesStore } from './audioFilesStore';

// ─── Filter ───────────────────────────────────────────────────────────────────

export type LibrarySort = 'newest' | 'oldest' | 'mastery' | 'alpha';

export interface LibraryFilter {
  type: SavedItemType | 'all';
  mastery: MasteryLevel | 'all';
  audioFileId: number | null;
  searchQuery: string;
  sortBy: LibrarySort;
}

const DEFAULT_FILTER: LibraryFilter = {
  type: 'all',
  mastery: 'all',
  audioFileId: null,
  searchQuery: '',
  sortBy: 'newest',
};

const MASTERY_ORDER: Record<MasteryLevel, number> = { new: 0, learning: 1, mastered: 2 };

function applyFilter(items: SavedItem[], filter: LibraryFilter): SavedItem[] {
  const filtered = items.filter(item => {
    if (filter.type !== 'all' && item.type !== filter.type) return false;
    if (filter.mastery !== 'all' && item.mastery !== filter.mastery) return false;
    if (filter.audioFileId !== null && item.audioFileId !== filter.audioFileId) return false;
    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      const match =
        item.text.toLowerCase().includes(q) ||
        item.contextSentence.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  switch (filter.sortBy) {
    case 'oldest':  return filtered.sort((a, b) => a.dateAdded - b.dateAdded);
    case 'mastery': return filtered.sort((a, b) =>
      MASTERY_ORDER[a.mastery] - MASTERY_ORDER[b.mastery] || b.dateAdded - a.dateAdded);
    case 'alpha':   return filtered.sort((a, b) => a.text.localeCompare(b.text));
    case 'newest':
    default:        return filtered.sort((a, b) => b.dateAdded - a.dateAdded);
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface LibraryStore {
  items: SavedItem[];
  filteredItems: SavedItem[];
  filter: LibraryFilter;
  isLoading: boolean;
  error: string | null;

  loadItems: () => Promise<void>;
  addItem: (data: Omit<SavedItem, 'id' | 'dateAdded' | 'nextReview' | 'enrichment' | 'clipUri' | 'sourceTitle' | 'note' | 'easeFactor' | 'intervalDays' | 'reviewCount'>) => Promise<number>;
  removeItem: (item: SavedItem) => Promise<void>;
  removeItems: (items: SavedItem[]) => Promise<void>;
  updateMastery: (id: number, mastery: MasteryLevel) => Promise<void>;
  updateMasteryMany: (ids: number[], mastery: MasteryLevel) => Promise<void>;
  editItemText: (id: number, text: string, contextSentence: string) => Promise<void>;
  setNote: (id: number, note: string) => Promise<void>;
  scheduleReview: (id: number, nextReview: number | null) => Promise<void>;
  applySrs: (id: number, state: SrsState) => Promise<void>;
  enrichItem: (id: number) => Promise<SavedItem>;
  setFilter: (partial: Partial<LibraryFilter>) => void;
  resetFilter: () => void;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  items: [],
  filteredItems: [],
  filter: DEFAULT_FILTER,
  isLoading: false,
  error: null,

  loadItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await getAllSavedItems();
      set(state => ({
        items,
        filteredItems: applyFilter(items, state.filter),
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  addItem: async (data) => {
    // Denormalize the source title so it outlives the audio file row
    const sourceTitle = data.audioFileId !== null
      ? useAudioFilesStore.getState().audioFiles.find(f => f.id === data.audioFileId)?.title ?? null
      : null;
    const id = await insertSavedItem({ ...data, sourceTitle });
    if (data.audioFileId !== null) {
      await incrementPhraseCount(data.audioFileId);
    }
    await get().loadItems();
    if (data.audioFileId !== null) {
      await useAudioFilesStore.getState().refreshAudioFile(data.audioFileId);
    }

    // Best-effort: generate AI learning notes in the background while we're
    // likely online. Skipped when AI notes are disabled in Settings, offline
    // or no API key — the user can always generate manually from item detail.
    void getSettings().then(s => {
      if (s.aiEnabled) return get().enrichItem(id);
    }).catch(() => {});

    return id;
  },

  removeItem: async (item) => {
    await deleteSavedItem(item.id);
    if (item.clipUri) deleteClipFile(item.clipUri);
    if (item.audioFileId !== null) {
      await decrementPhraseCount(item.audioFileId);
      await useAudioFilesStore.getState().refreshAudioFile(item.audioFileId);
    }
    set(state => {
      const items = state.items.filter(i => i.id !== item.id);
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
  },

  removeItems: async (itemsToRemove) => {
    if (itemsToRemove.length === 0) return;
    const affectedFiles = new Set<number>();
    for (const item of itemsToRemove) {
      await deleteSavedItem(item.id);
      if (item.clipUri) deleteClipFile(item.clipUri);
      if (item.audioFileId !== null) {
        await decrementPhraseCount(item.audioFileId);
        affectedFiles.add(item.audioFileId);
      }
    }
    const removedIds = new Set(itemsToRemove.map(i => i.id));
    set(state => {
      const items = state.items.filter(i => !removedIds.has(i.id));
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
    for (const fileId of affectedFiles) {
      await useAudioFilesStore.getState().refreshAudioFile(fileId);
    }
  },

  updateMastery: async (id, mastery) => {
    await updateMastery(id, mastery);
    // Update the item in place WITHOUT re-running the filter: if a mastery
    // filter is active (e.g. "New"), re-filtering would immediately drop the
    // card the user just re-tagged, making it vanish mid-review. Keep it where
    // it is until the user next changes a filter or reloads.
    set(state => ({
      items: state.items.map(i => i.id === id ? { ...i, mastery } : i),
      filteredItems: state.filteredItems.map(i => i.id === id ? { ...i, mastery } : i),
    }));
  },

  updateMasteryMany: async (ids, mastery) => {
    if (ids.length === 0) return;
    for (const id of ids) await updateMastery(id, mastery);
    // Update in place without re-filtering — same reasoning as updateMastery:
    // a re-tagged card shouldn't vanish from under an active mastery filter.
    const idSet = new Set(ids);
    set(state => ({
      items: state.items.map(i => idSet.has(i.id) ? { ...i, mastery } : i),
      filteredItems: state.filteredItems.map(i => idSet.has(i.id) ? { ...i, mastery } : i),
    }));
  },

  editItemText: async (id, text, contextSentence) => {
    await updateSavedItemText(id, text, contextSentence);
    set(state => {
      const items = state.items.map(i =>
        i.id === id ? { ...i, text, contextSentence } : i
      );
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
  },

  setNote: async (id, note) => {
    await updateNote(id, note);
    const value = note.trim() || null;
    set(state => {
      const items = state.items.map(i => i.id === id ? { ...i, note: value } : i);
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
  },

  scheduleReview: async (id, nextReview) => {
    await updateNextReview(id, nextReview);
    set(state => {
      const items = state.items.map(i => i.id === id ? { ...i, nextReview } : i);
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
  },

  applySrs: async (id, srs) => {
    await updateSrsState(id, srs);
    set(state => {
      const items = state.items.map(i =>
        i.id === id
          ? { ...i, easeFactor: srs.easeFactor, intervalDays: srs.intervalDays,
              reviewCount: srs.reviewCount, nextReview: srs.nextReview, mastery: srs.mastery }
          : i
      );
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
  },

  enrichItem: async (id) => {
    const item = get().items.find(i => i.id === id);
    if (!item) throw new Error('Item not found');
    if (item.enrichment) return item; // already generated — cached forever

    // Provider + key resolution happens inside generateEnrichment → ai.ts,
    // which throws a clear message if no key is configured.
    const enrichment = await generateEnrichment(item);
    await updateEnrichment(id, enrichment);

    const updated = { ...item, enrichment };
    set(state => {
      const items = state.items.map(i => (i.id === id ? updated : i));
      return { items, filteredItems: applyFilter(items, state.filter) };
    });
    return updated;
  },

  setFilter: (partial) => {
    set(state => {
      const filter = { ...state.filter, ...partial };
      return { filter, filteredItems: applyFilter(state.items, filter) };
    });
  },

  resetFilter: () => {
    set(state => ({
      filter: DEFAULT_FILTER,
      filteredItems: applyFilter(state.items, DEFAULT_FILTER),
    }));
  },
}));
