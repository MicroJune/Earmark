// ─── Text utilities ───────────────────────────────────────────────────────────

/**
 * Normalize text for duplicate detection and matching: lowercase, drop
 * punctuation (apostrophes, commas, quotes…) and collapse whitespace. So
 * Whisper variants like "I'm coming down with the flu" and "Im coming down
 * with the flu" compare equal.
 */
export function normalizeText(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
