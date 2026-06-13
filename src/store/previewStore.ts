import { create } from 'zustand';

// Tracks the single active audio "preview" — a short [start,end] excerpt played
// from the Library item detail or the Review modes. Only one preview can play
// at a time, and starting one pauses the main transcript player. The UI reads
// this to show a play/pause icon on the relevant button.

export type PreviewStatus = 'idle' | 'loading' | 'playing' | 'paused';

interface PreviewStore {
  // Identifies which button owns the current preview (e.g. `item-42`).
  activeKey: string | null;
  status: PreviewStatus;
  set: (key: string | null, status: PreviewStatus) => void;
}

export const usePreviewStore = create<PreviewStore>(set => ({
  activeKey: null,
  status: 'idle',
  set: (activeKey, status) => set({ activeKey, status }),
}));
