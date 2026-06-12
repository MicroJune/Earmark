export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS audio_files (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    uri           TEXT    NOT NULL,
    duration      REAL    NOT NULL DEFAULT 0,
    date_added    INTEGER NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending',
    phrase_count  INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS segments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id    INTEGER NOT NULL,
    segment_index    INTEGER NOT NULL,
    text             TEXT    NOT NULL,
    start            REAL    NOT NULL,
    end              REAL    NOT NULL,
    word_start_index INTEGER NOT NULL,
    word_end_index   INTEGER NOT NULL,
    FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS words (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id INTEGER NOT NULL,
    word_index    INTEGER NOT NULL,
    segment_id    INTEGER NOT NULL,
    word          TEXT    NOT NULL,
    start         REAL    NOT NULL,
    end           REAL    NOT NULL,
    FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE,
    FOREIGN KEY (segment_id)    REFERENCES segments(id)    ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_items (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    audio_file_id    INTEGER NOT NULL,
    text             TEXT    NOT NULL,
    context_sentence TEXT    NOT NULL,
    start_time       REAL    NOT NULL,
    end_time         REAL    NOT NULL,
    type             TEXT    NOT NULL,
    mastery          TEXT    NOT NULL DEFAULT 'new',
    date_added       INTEGER NOT NULL,
    next_review      INTEGER,
    FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_segments_audio_file_id ON segments(audio_file_id);
  CREATE INDEX IF NOT EXISTS idx_words_audio_file_id    ON words(audio_file_id);
  CREATE INDEX IF NOT EXISTS idx_words_lookup           ON words(audio_file_id, word_index);
  CREATE INDEX IF NOT EXISTS idx_saved_audio_file_id    ON saved_items(audio_file_id);
  CREATE INDEX IF NOT EXISTS idx_saved_next_review      ON saved_items(next_review);
  CREATE INDEX IF NOT EXISTS idx_saved_mastery          ON saved_items(mastery);
`;
