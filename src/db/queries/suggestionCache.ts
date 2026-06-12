import { getDb } from '../index';
import type { PhraseSuggestion } from '../../types';

interface SuggestionCacheRow {
  audio_file_id: number;
  suggestions: string; // JSON
  created_at: number;
}

export async function getCachedSuggestions(
  audioFileId: number
): Promise<PhraseSuggestion[] | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SuggestionCacheRow>(
    'SELECT * FROM suggestion_cache WHERE audio_file_id = ?',
    [audioFileId]
  );
  if (!row) return null;
  return JSON.parse(row.suggestions) as PhraseSuggestion[];
}

export async function setCachedSuggestions(
  audioFileId: number,
  suggestions: PhraseSuggestion[]
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO suggestion_cache (audio_file_id, suggestions, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(audio_file_id) DO UPDATE SET suggestions = excluded.suggestions, created_at = excluded.created_at`,
    [audioFileId, JSON.stringify(suggestions), Date.now()]
  );
}

export async function deleteCachedSuggestions(audioFileId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM suggestion_cache WHERE audio_file_id = ?',
    [audioFileId]
  );
}
