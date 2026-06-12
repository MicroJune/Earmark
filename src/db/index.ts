import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  const db = await SQLite.openDatabaseAsync('postcast.db');
  try {
    try {
      await db.execAsync('PRAGMA journal_mode = WAL;');
    } catch {
      // WAL is a performance optimization; schema correctness does not depend on it.
    }

    await db.execAsync('PRAGMA foreign_keys = ON;');
    await runMigrations(db);
    _db = db;
    return db;
  } catch (error) {
    _db = null;
    throw error;
  }
}
