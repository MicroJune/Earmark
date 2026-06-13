import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '../index';
import type { ParsedTranscript } from '../../utils/transcriptBuilder';

// Rows per multi-row INSERT. 100 rows × 7 params = 700 bind variables,
// safely under SQLite's lowest variable limit (999). Batching matters:
// a 1-hour podcast has ~9000 words, and inserting them one statement at a
// time holds the write transaction open for minutes and freezes the UI.
const CHUNK = 100;

/**
 * Inserts a transcript's segments + words for a file, resolving segmentIndex →
 * real DB id for the word rows. Assumes the segments/words tables are already
 * empty for this file. The caller MUST already be inside a transaction —
 * expo-sqlite has no nested transactions, so this helper opens none of its own
 * (lets both replaceTranscript and the backup importer reuse it).
 */
export async function insertTranscriptRows(
  db: SQLiteDatabase,
  audioFileId: number,
  transcript: ParsedTranscript
): Promise<void> {
  for (let i = 0; i < transcript.segments.length; i += CHUNK) {
    const chunk = transcript.segments.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = chunk.flatMap(seg => [
      audioFileId,
      seg.segmentIndex,
      seg.text,
      seg.start,
      seg.end,
      seg.wordStartIndex,
      seg.wordEndIndex,
    ]);
    await db.runAsync(
      `INSERT INTO segments
        (audio_file_id, segment_index, text, start, end, word_start_index, word_end_index)
       VALUES ${placeholders}`,
      params
    );
  }

  // Resolve segmentIndex → real DB id for the word rows
  const idRows = await db.getAllAsync<{ id: number; segment_index: number }>(
    'SELECT id, segment_index FROM segments WHERE audio_file_id = ?',
    [audioFileId]
  );
  const segmentIds: number[] = [];
  for (const row of idRows) segmentIds[row.segment_index] = row.id;

  for (let i = 0; i < transcript.words.length; i += CHUNK) {
    const chunk = transcript.words.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params: (string | number)[] = [];
    for (const word of chunk) {
      const segmentId = segmentIds[word.segmentIndex];
      if (segmentId === undefined) {
        throw new Error(`Missing segment for word index ${word.wordIndex}`);
      }
      params.push(audioFileId, word.wordIndex, segmentId, word.word, word.start, word.end);
    }
    await db.runAsync(
      `INSERT INTO words (audio_file_id, word_index, segment_id, word, start, end)
       VALUES ${placeholders}`,
      params
    );
  }
}

export async function replaceTranscript(
  audioFileId: number,
  transcript: ParsedTranscript
): Promise<void> {
  const db = await getDb();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM words WHERE audio_file_id = ?', [audioFileId]);
    await db.runAsync('DELETE FROM segments WHERE audio_file_id = ?', [audioFileId]);
    await insertTranscriptRows(db, audioFileId, transcript);
  });
}
