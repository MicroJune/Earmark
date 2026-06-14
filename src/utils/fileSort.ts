import type { AudioFile } from '../types';
import type { FileSortMode } from '../services/settings';

// Orders a list of audio files the way the category screen displays them, so
// that sequential playback ('all' / 顺序循环) advances in the order the user
// actually sees. Shared by CategoryScreen (display) and ContentViewScreen
// (playlist advance).
//
// `sizes` is only consulted for the 'size' mode; pass an empty map otherwise.
export function sortFiles(
  files: AudioFile[],
  mode: FileSortMode,
  sizes: Map<number, number>
): AudioFile[] {
  const arr = [...files];
  switch (mode) {
    case 'name':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'size':
      return arr.sort((a, b) => (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0));
    case 'manual':
      return arr.sort((a, b) => {
        // Manually positioned files first (by position); unplaced ones after, newest first
        if (a.sortOrder === null && b.sortOrder === null) return b.dateAdded - a.dateAdded;
        if (a.sortOrder === null) return 1;
        if (b.sortOrder === null) return -1;
        return a.sortOrder - b.sortOrder;
      });
    case 'date':
    default:
      return arr.sort((a, b) => b.dateAdded - a.dateAdded);
  }
}
