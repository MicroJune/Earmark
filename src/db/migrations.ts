import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA } from './schema';

interface Migration {
  version: number;
  up: string;
}

// Add new migrations here as the schema evolves.
// Never modify an existing migration — add a new one.
const migrations: Migration[] = [
  { version: 1, up: SCHEMA },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS suggestion_cache (
        audio_file_id INTEGER PRIMARY KEY,
        suggestions   TEXT    NOT NULL,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS review_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id     INTEGER NOT NULL,
        reviewed_at INTEGER NOT NULL,
        correct     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_review_log_reviewed_at ON review_log(reviewed_at);
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        date_added INTEGER NOT NULL
      );
      -- NULL category_id = uncategorized. Integrity on category deletion is
      -- handled in the delete query (files are moved back to uncategorized),
      -- so no FK constraint is needed here.
      ALTER TABLE audio_files ADD COLUMN category_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_audio_files_category ON audio_files(category_id);
    `,
  },
  {
    version: 5,
    up: `
      -- AI learning notes (translation, synonyms, examples) as a JSON blob.
      -- NULL = not generated yet.
      ALTER TABLE saved_items ADD COLUMN enrichment TEXT;
    `,
  },
  {
    version: 6,
    up: `
      -- Remember where the user stopped listening (seconds).
      ALTER TABLE audio_files ADD COLUMN last_position REAL NOT NULL DEFAULT 0;

      -- Rebuild saved_items: learning cards must survive deletion of their
      -- source audio file (was ON DELETE CASCADE). audio_file_id becomes
      -- nullable with ON DELETE SET NULL; clip_uri holds an extracted audio
      -- excerpt so review playback works without the original file;
      -- source_title is denormalized so the source name outlives the file row.
      CREATE TABLE saved_items_new (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        audio_file_id    INTEGER,
        text             TEXT    NOT NULL,
        context_sentence TEXT    NOT NULL,
        start_time       REAL    NOT NULL,
        end_time         REAL    NOT NULL,
        type             TEXT    NOT NULL,
        mastery          TEXT    NOT NULL DEFAULT 'new',
        date_added       INTEGER NOT NULL,
        next_review      INTEGER,
        enrichment       TEXT,
        clip_uri         TEXT,
        source_title     TEXT,
        FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE SET NULL
      );
      INSERT INTO saved_items_new
        (id, audio_file_id, text, context_sentence, start_time, end_time,
         type, mastery, date_added, next_review, enrichment)
        SELECT id, audio_file_id, text, context_sentence, start_time, end_time,
               type, mastery, date_added, next_review, enrichment
        FROM saved_items;
      UPDATE saved_items_new SET source_title =
        (SELECT title FROM audio_files WHERE audio_files.id = saved_items_new.audio_file_id);
      DROP TABLE saved_items;
      ALTER TABLE saved_items_new RENAME TO saved_items;
      CREATE INDEX IF NOT EXISTS idx_saved_audio_file_id ON saved_items(audio_file_id);
      CREATE INDEX IF NOT EXISTS idx_saved_next_review   ON saved_items(next_review);
      CREATE INDEX IF NOT EXISTS idx_saved_mastery       ON saved_items(mastery);
    `,
  },
  {
    version: 7,
    up: `
      -- Manual ("custom") ordering of files within a category.
      -- NULL = never manually positioned; sorts after positioned files.
      ALTER TABLE audio_files ADD COLUMN sort_order INTEGER;
    `,
  },
];

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  const { user_version: currentVersion } = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  ) ?? { user_version: 0 };

  const pending = migrations.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.up);
      await db.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
