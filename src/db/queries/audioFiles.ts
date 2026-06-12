import { getDb } from '../index';
import type { AudioFile, AudioFileStatus } from '../../types';

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface AudioFileRow {
  id: number;
  title: string;
  uri: string;
  duration: number;
  date_added: number;
  status: AudioFileStatus;
  phrase_count: number;
  error_message: string | null;
  category_id: number | null;
  last_position: number;
}

function rowToAudioFile(row: AudioFileRow): AudioFile {
  return {
    id: row.id,
    title: row.title,
    uri: row.uri,
    duration: row.duration,
    dateAdded: row.date_added,
    status: row.status,
    phraseCount: row.phrase_count,
    errorMessage: row.error_message ?? undefined,
    categoryId: row.category_id,
    lastPosition: row.last_position,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function insertAudioFile(
  data: Pick<AudioFile, 'title' | 'uri'> & { categoryId?: number | null }
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO audio_files (title, uri, date_added, status, phrase_count, category_id) VALUES (?, ?, ?, ?, ?, ?)',
    [data.title, data.uri, Date.now(), 'pending', 0, data.categoryId ?? null]
  );
  return result.lastInsertRowId;
}

export async function getAudioFile(id: number): Promise<AudioFile | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AudioFileRow>(
    'SELECT * FROM audio_files WHERE id = ?',
    [id]
  );
  return row ? rowToAudioFile(row) : null;
}

export async function getAllAudioFiles(): Promise<AudioFile[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AudioFileRow>(
    'SELECT * FROM audio_files ORDER BY date_added DESC'
  );
  return rows.map(rowToAudioFile);
}

export async function updateAudioFileStatus(
  id: number,
  status: AudioFileStatus,
  errorMessage?: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET status = ?, error_message = ? WHERE id = ?',
    [status, errorMessage ?? null, id]
  );
}

export async function updateAudioFileDuration(
  id: number,
  duration: number
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET duration = ? WHERE id = ?',
    [duration, id]
  );
}

export async function updateAudioFileTitle(
  id: number,
  title: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET title = ? WHERE id = ?',
    [title, id]
  );
}

export async function updateAudioFilePosition(id: number, position: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET last_position = ? WHERE id = ?',
    [Math.max(0, position), id]
  );
}

export async function incrementPhraseCount(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET phrase_count = phrase_count + 1 WHERE id = ?',
    [id]
  );
}

export async function decrementPhraseCount(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE audio_files SET phrase_count = MAX(0, phrase_count - 1) WHERE id = ?',
    [id]
  );
}

/**
 * Recovers files stuck in 'transcribing' after the app was killed
 * mid-transcription. Without this they stay disabled in the UI forever.
 * Call once at app startup.
 */
export async function recoverInterruptedTranscriptions(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE audio_files
     SET status = 'error', error_message = 'Transcription was interrupted. Tap to retry.'
     WHERE status = 'transcribing'`
  );
}

export async function deleteAudioFile(id: number): Promise<void> {
  const db = await getDb();
  // Cascades to segments, words, saved_items via FK ON DELETE CASCADE
  await db.runAsync('DELETE FROM audio_files WHERE id = ?', [id]);
}
