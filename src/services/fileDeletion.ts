import { getAudioFile, deleteAudioFile } from '../db/queries/audioFiles';
import { getSavedItemsByAudioFile, updateSavedItemClip } from '../db/queries/savedItems';
import { deleteImportedAudio } from './filePicker';
import { extractClips, isClipExtractionSupported } from './clips';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { useLibraryStore } from '../store/libraryStore';
import { log } from '../utils/logger';

// ─── Audio file deletion that preserves learning cards ────────────────────────
// Deleting a podcast must never destroy the user's saved phrases. Before the
// file goes away we extract a small audio clip per saved item (one decode for
// all of them); the DB then detaches the items (FK ON DELETE SET NULL) instead
// of cascading. Transcript rows (segments/words) still cascade — they are
// useless without the audio.

export interface DeletionPreview {
  savedItemCount: number;     // cards that will be preserved
  clipsWillBeExtracted: boolean; // false in Expo Go — cards survive but lose audio
}

/** What deleting this file would do — for confirmation dialogs. */
export async function previewAudioFileDeletion(audioFileId: number): Promise<DeletionPreview> {
  const items = await getSavedItemsByAudioFile(audioFileId);
  const missingClips = items.some(i => !i.clipUri);
  return {
    savedItemCount: items.length,
    clipsWillBeExtracted: !missingClips || isClipExtractionSupported(),
  };
}

/**
 * Deletes an audio file (DB row + transcript + the imported copy on disk)
 * while keeping its saved items reviewable: clips are extracted first when
 * the native decoder is available.
 */
export async function deleteAudioFileKeepingCards(audioFileId: number): Promise<void> {
  const file =
    useAudioFilesStore.getState().audioFiles.find(f => f.id === audioFileId) ??
    await getAudioFile(audioFileId);
  if (!file) return;

  // 1. Best-effort clip extraction for items that don't have one yet.
  const items = await getSavedItemsByAudioFile(audioFileId);
  const needingClips = items.filter(i => !i.clipUri);
  if (needingClips.length > 0 && isClipExtractionSupported()) {
    try {
      const clips = await extractClips(
        file.uri,
        needingClips.map(i => ({ id: i.id, startTime: i.startTime, endTime: i.endTime }))
      );
      for (const [itemId, clipUri] of clips) {
        await updateSavedItemClip(itemId, clipUri);
      }
    } catch (e) {
      // Cards still survive — they just lose original-audio playback.
      log.warn('fileDeletion', 'clip extraction failed', e instanceof Error ? e.message : String(e));
    }
  }

  // 2. Delete the DB row: segments/words cascade, saved_items detach (SET NULL).
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
