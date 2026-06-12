import { getDb } from '../index';
import type { Word } from '../../types';

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface WordRow {
  id: number;
  audio_file_id: number;
  word_index: number;
  segment_id: number;
  word: string;
  start: number;
  end: number;
}

function rowToWord(row: WordRow): Word {
  return {
    id: row.id,
    audioFileId: row.audio_file_id,
    wordIndex: row.word_index,
    segmentId: row.segment_id,
    word: row.word,
    start: row.start,
    end: row.end,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// Bulk insert — words can number in the thousands for long audio files.
// Chunked into batches of 500 within a single transaction to avoid SQLite variable limits.
export async function insertWords(
  audioFileId: number,
  words: Omit<Word, 'id' | 'audioFileId'>[]
): Promise<void> {
  const db = await getDb();
  const CHUNK = 500;

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < words.length; i += CHUNK) {
      const chunk = words.slice(i, i + CHUNK);
      for (const w of chunk) {
        await db.runAsync(
          'INSERT INTO words (audio_file_id, word_index, segment_id, word, start, end) VALUES (?, ?, ?, ?, ?, ?)',
          [audioFileId, w.wordIndex, w.segmentId, w.word, w.start, w.end]
        );
      }
    }
  });
}

export async function getWordsByAudioFile(audioFileId: number): Promise<Word[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<WordRow>(
    'SELECT * FROM words WHERE audio_file_id = ? ORDER BY word_index ASC',
    [audioFileId]
  );
  return rows.map(rowToWord);
}

export async function deleteWordsByAudioFile(audioFileId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM words WHERE audio_file_id = ?', [audioFileId]);
}
