import { create } from 'zustand';
import type { AudioFile, AudioFileStatus, Category } from '../types';
import {
  getAllAudioFiles,
  getAudioFile,
  insertAudioFile,
  updateAudioFileStatus,
  updateAudioFileDuration,
  updateAudioFileTitle,
  setAudioFileSortOrders,
} from '../db/queries/audioFiles';
import {
  getAllCategories,
  insertCategory,
  renameCategory,
  deleteCategory,
  setAudioFilesCategory,
} from '../db/queries/categories';

interface AudioFilesStore {
  audioFiles: AudioFile[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  // Live progress (0..1) per file id while on-device transcription runs.
  transcriptionProgress: Record<number, number>;

  setTranscriptionProgress: (id: number, fraction: number | null) => void;
  loadAudioFiles: () => Promise<void>;
  addAudioFile: (data: Pick<AudioFile, 'title' | 'uri'> & { categoryId?: number | null }) => Promise<number>;
  refreshAudioFile: (id: number) => Promise<void>;
  updateStatus: (id: number, status: AudioFileStatus, errorMessage?: string) => Promise<void>;
  updateDuration: (id: number, duration: number) => Promise<void>;
  updateTitle: (id: number, title: string) => Promise<void>;

  loadCategories: () => Promise<void>;
  addCategory: (name: string) => Promise<number>;
  updateCategoryName: (id: number, name: string) => Promise<void>;
  removeCategory: (id: number) => Promise<void>;
  moveFilesToCategory: (fileIds: number[], categoryId: number | null) => Promise<void>;
  // Persist a manual ordering (array index = position) for a category's files.
  reorderFiles: (orderedIds: number[]) => Promise<void>;
}

export const useAudioFilesStore = create<AudioFilesStore>((set, get) => ({
  audioFiles: [],
  categories: [],
  isLoading: false,
  error: null,
  transcriptionProgress: {},

  setTranscriptionProgress: (id, fraction) => {
    set(state => {
      const transcriptionProgress = { ...state.transcriptionProgress };
      if (fraction === null) delete transcriptionProgress[id];
      else transcriptionProgress[id] = fraction;
      return { transcriptionProgress };
    });
  },

  loadAudioFiles: async () => {
    set({ isLoading: true, error: null });
    try {
      const audioFiles = await getAllAudioFiles();
      set({ audioFiles });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  addAudioFile: async (data) => {
    const id = await insertAudioFile(data);
    await get().loadAudioFiles();
    return id;
  },

  refreshAudioFile: async (id) => {
    const updated = await getAudioFile(id);
    if (!updated) return;
    set(state => ({
      audioFiles: state.audioFiles.map(f => f.id === id ? updated : f),
    }));
  },

  updateStatus: async (id, status, errorMessage) => {
    await updateAudioFileStatus(id, status, errorMessage);
    await get().refreshAudioFile(id);
  },

  updateDuration: async (id, duration) => {
    await updateAudioFileDuration(id, duration);
    await get().refreshAudioFile(id);
  },

  updateTitle: async (id, title) => {
    await updateAudioFileTitle(id, title);
    await get().refreshAudioFile(id);
  },

  loadCategories: async () => {
    try {
      const categories = await getAllCategories();
      set({ categories });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  addCategory: async (name) => {
    const id = await insertCategory(name.trim());
    await get().loadCategories();
    return id;
  },

  updateCategoryName: async (id, name) => {
    await renameCategory(id, name.trim());
    await get().loadCategories();
  },

  removeCategory: async (id) => {
    await deleteCategory(id);
    set(state => ({
      categories: state.categories.filter(c => c.id !== id),
      // Files of a deleted category fall back to uncategorized.
      audioFiles: state.audioFiles.map(f =>
        f.categoryId === id ? { ...f, categoryId: null } : f
      ),
    }));
  },

  moveFilesToCategory: async (fileIds, categoryId) => {
    await setAudioFilesCategory(fileIds, categoryId);
    const moved = new Set(fileIds);
    set(state => ({
      audioFiles: state.audioFiles.map(f =>
        moved.has(f.id) ? { ...f, categoryId } : f
      ),
    }));
  },

  reorderFiles: async (orderedIds) => {
    await setAudioFileSortOrders(orderedIds);
    const orderOf = new Map(orderedIds.map((id, i) => [id, i]));
    set(state => ({
      audioFiles: state.audioFiles.map(f =>
        orderOf.has(f.id) ? { ...f, sortOrder: orderOf.get(f.id)! } : f
      ),
    }));
  },
}));
