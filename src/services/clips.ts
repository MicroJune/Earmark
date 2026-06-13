import { File, Directory, Paths } from 'expo-file-system';

// ─── Legacy clip cleanup ──────────────────────────────────────────────────────
// Saved items used to keep an extracted WAV clip so they could outlive their
// source file. That model was dropped: deleting an audio file now also deletes
// its saved items, and review plays the original audio sliced live from the
// source. These helpers only clean up clip files left over from the old model.

export function deleteClipFile(clipUri: string): void {
  try {
    const f = new File(clipUri);
    if (f.exists) f.delete();
  } catch {}
}

/** Total bytes used by any leftover extracted clips (for the storage screen). */
export function getClipsStorageBytes(): number {
  try {
    const dir = new Directory(Paths.document, 'clips');
    if (!dir.exists) return 0;
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}
