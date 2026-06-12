import { getDb } from '../index';
import type { Segment } from '../../types';

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface SegmentRow {
  id: number;
  audio_file_id: number;
  segment_index: number;
  text: string;
  start: number;
  end: number;
  word_start_index: number;
  word_end_index: number;
}

function rowToSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    audioFileId: row.audio_file_id,
    segmentIndex: row.segment_index,
    text: row.text,
    start: row.start,
    end: row.end,
    wordStartIndex: row.word_start_index,
    wordEndIndex: row.word_end_index,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function insertSegments(
  audioFileId: number,
  segments: Omit<Segment, 'id' | 'audioFileId'>[]
): Promise<number[]> {
  const db = await getDb();
  const ids: number[] = [];

  await db.withTransactionAsync(async () => {
    for (const seg of segments) {
      const result = await db.runAsync(
        `INSERT INTO segments
          (audio_file_id, segment_index, text, start, end, word_start_index, word_end_index)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [audioFileId, seg.segmentIndex, seg.text, seg.start, seg.end, seg.wordStartIndex, seg.wordEndIndex]
      );
      ids.push(result.lastInsertRowId);
    }
  });

  return ids;
}

export async function getSegmentsByAudioFile(audioFileId: number): Promise<Segment[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SegmentRow>(
    'SELECT * FROM segments WHERE audio_file_id = ? ORDER BY segment_index ASC',
    [audioFileId]
  );
  return rows.map(rowToSegment);
}

export async function getSegmentAtTime(
  audioFileId: number,
  time: number
): Promise<Segment | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SegmentRow>(
    'SELECT * FROM segments WHERE audio_file_id = ? AND start <= ? AND end >= ? LIMIT 1',
    [audioFileId, time, time]
  );
  return row ? rowToSegment(row) : null;
}

export async function deleteSegmentsByAudioFile(audioFileId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM segments WHERE audio_file_id = ?', [audioFileId]);
}
