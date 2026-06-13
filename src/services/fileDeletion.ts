import { getAudioFile, deleteAudioFile } from '../db/queries/audioFiles';
import { getSavedItemsByAudioFile, deleteSavedItemsByAudioFile } from '../db/queries/savedItems';
import { deleteImportedAudio } from './filePicker';
import { deleteClipFile } from './clips';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { useLibraryStore } from '../store/libraryStore';
import { log } from '../utils/logger';

// ─── Audio file deletion (cascades to its saved items) ────────────────────────
// Saved words/phrases/sentences are tied to their source audio: review plays
// the real podcast audio sliced live from the source file, so an item without
// its source is no longer useful. Deleting a file therefore removes its saved
// items too. Review history (review_log) is deliberately KEPT so the user's
// streak and daily stats survive.

export interface DeletionPreview {
  savedItemCount: number; // saved items that will ALSO be deleted
}

/** What deleting this file would remove — for confirmation dialogs. */
export async function previewAudioFileDeletion(audioFileId: number): Promise<DeletionPreview> {
  const items = await getSavedItemsByAudioFile(audioFileId);
  return { savedItemCount: items.length };
}

/**
 * Deletes an audio file and everything tied to it: transcript (segments/words
 * cascade), saved items + their review logs + any cached clip files, and the
 * imported audio copy on disk.
 */
export async function deleteAudioFileAndItems(audioFileId: number): Promise<void> {
  const file =
    useAudioFilesStore.getState().audioFiles.find(f => f.id === audioFileId) ??
    await getAudioFile(audioFileId);
  if (!file) return;

  // 1. Remove saved items + any leftover clip files. Review history
  //    (review_log) is intentionally kept so the streak survives.
  const items = await getSavedItemsByAudioFile(audioFileId);
  if (items.length > 0) {
    for (const i of items) {
      if (i.clipUri) deleteClipFile(i.clipUri);
    }
    await deleteSavedItemsByAudioFile(audioFileId);
    log.info('fileDeletion', `deleted ${items.length} saved item(s) with file ${audioFileId}`);
  }

  // 2. Delete the DB row — segments/words/suggestion_cache cascade.
  await deleteAudioFile(audioFileId);

  // 3. Remove the imported audio copy from disk.
  if (file.uri) {
    try { await deleteImportedAudio(file.uri); } catch {}
  }

  // 4. Refresh stores.
  useAudioFilesStore.setState(state => ({
    audioFiles: state.audioFiles.filter(f => f.id !== audioFileId),
  }));
  void useLibraryStore.getState().loadItems();
}
