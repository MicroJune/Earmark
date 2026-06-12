import { getDb } from '../index';
import type { SavedItem, SavedItemType, MasteryLevel, ItemEnrichment } from '../../types';

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface SavedItemRow {
  id: number;
  audio_file_id: number | null;
  text: string;
  context_sentence: string;
  start_time: number;
  end_time: number;
  type: SavedItemType;
  mastery: MasteryLevel;
  date_added: number;
  next_review: number | null;
  enrichment: string | null; // JSON-serialized ItemEnrichment
  clip_uri: string | null;
  source_title: string | null;
}

function parseEnrichment(json: string | null): ItemEnrichment | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ItemEnrichment;
  } catch {
    return null; // corrupt blob — treat as not enriched
  }
}

function rowToSavedItem(row: SavedItemRow): SavedItem {
  return {
    id: row.id,
    audioFileId: row.audio_file_id,
    text: row.text,
    contextSentence: row.context_sentence,
    startTime: row.start_time,
    endTime: row.end_time,
    type: row.type,
    mastery: row.mastery,
    dateAdded: row.date_added,
    nextReview: row.next_review,
    enrichment: parseEnrichment(row.enrichment),
    clipUri: row.clip_uri,
    sourceTitle: row.source_title,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function insertSavedItem(
  data: Omit<SavedItem, 'id' | 'dateAdded' | 'nextReview' | 'enrichment' | 'clipUri'>
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO saved_items
      (audio_file_id, text, context_sentence, start_time, end_time, type, mastery, date_added, source_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.audioFileId,
      data.text,
      data.contextSentence,
      data.startTime,
      data.endTime,
      data.type,
      data.mastery,
      Date.now(),
      data.sourceTitle,
    ]
  );
  return result.lastInsertRowId;
}

export async function getSavedItem(id: number): Promise<SavedItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SavedItemRow>(
    'SELECT * FROM saved_items WHERE id = ?',
    [id]
  );
  return row ? rowToSavedItem(row) : null;
}

export async function getAllSavedItems(): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    'SELECT * FROM saved_items ORDER BY date_added DESC'
  );
  return rows.map(rowToSavedItem);
}

export async function getSavedItemsByAudioFile(audioFileId: number): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    'SELECT * FROM saved_items WHERE audio_file_id = ? ORDER BY start_time ASC',
    [audioFileId]
  );
  return rows.map(rowToSavedItem);
}

export async function getSavedItemsByType(type: SavedItemType): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    'SELECT * FROM saved_items WHERE type = ? ORDER BY date_added DESC',
    [type]
  );
  return rows.map(rowToSavedItem);
}

export async function getSavedItemsByMastery(mastery: MasteryLevel): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    'SELECT * FROM saved_items WHERE mastery = ? ORDER BY date_added DESC',
    [mastery]
  );
  return rows.map(rowToSavedItem);
}

export async function getDueForReview(now = Date.now()): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    `SELECT * FROM saved_items
     WHERE mastery != 'mastered'
       AND (next_review IS NULL OR next_review <= ?)
     ORDER BY next_review ASC NULLS FIRST`,
    [now]
  );
  return rows.map(rowToSavedItem);
}

export async function searchSavedItems(query: string): Promise<SavedItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SavedItemRow>(
    `SELECT * FROM saved_items
     WHERE text LIKE ? OR context_sentence LIKE ?
     ORDER BY date_added DESC`,
    [`%${query}%`, `%${query}%`]
  );
  return rows.map(rowToSavedItem);
}

export async function updateMastery(id: number, mastery: MasteryLevel): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE saved_items SET mastery = ? WHERE id = ?',
    [mastery, id]
  );
}

export async function updateEnrichment(
  id: number,
  enrichment: ItemEnrichment
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE saved_items SET enrichment = ? WHERE id = ?',
    [JSON.stringify(enrichment), id]
  );
}

export async function updateSavedItemClip(id: number, clipUri: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE saved_items SET clip_uri = ? WHERE id = ?',
    [clipUri, id]
  );
}

export async function updateSavedItemText(
  id: number,
  text: string,
  contextSentence: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE saved_items SET text = ?, context_sentence = ? WHERE id = ?',
    [text, contextSentence, id]
  );
}

export async function updateNextReview(id: number, nextReview: number | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE saved_items SET next_review = ? WHERE id = ?',
    [nextReview, id]
  );
}

export async function deleteSavedItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM saved_items WHERE id = ?', [id]);
}

export async function deleteSavedItemsByAudioFile(audioFileId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM saved_items WHERE audio_file_id = ?', [audioFileId]);
}
