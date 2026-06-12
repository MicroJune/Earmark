import { getDb } from '../index';
import type { Category } from '../../types';

// ─── Row mapper ───────────────────────────────────────────────────────────────

interface CategoryRow {
  id: number;
  name: string;
  date_added: number;
}

function rowToCategory(row: CategoryRow): Category {
  return { id: row.id, name: row.name, dateAdded: row.date_added };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getAllCategories(): Promise<Category[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC'
  );
  return rows.map(rowToCategory);
}

export async function insertCategory(name: string): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    'INSERT INTO categories (name, date_added) VALUES (?, ?)',
    [name, Date.now()]
  );
  return result.lastInsertRowId;
}

export async function renameCategory(id: number, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
}

// Deleting a category never deletes its files — they go back to uncategorized.
export async function deleteCategory(id: number): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE audio_files SET category_id = NULL WHERE category_id = ?', [id]);
    await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
  });
}

export async function setAudioFilesCategory(
  fileIds: number[],
  categoryId: number | null
): Promise<void> {
  if (fileIds.length === 0) return;
  const db = await getDb();
  const placeholders = fileIds.map(() => '?').join(', ');
  await db.runAsync(
    `UPDATE audio_files SET category_id = ? WHERE id IN (${placeholders})`,
    [categoryId, ...fileIds]
  );
}
