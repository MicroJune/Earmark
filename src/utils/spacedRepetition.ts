import type { MasteryLevel } from '../types';

// ─── Review intervals per mastery level ───────────────────────────────────────

export const REVIEW_INTERVALS_MS: Record<MasteryLevel, number> = {
  new:      1 * 24 * 60 * 60 * 1000,  // 1 day
  learning: 3 * 24 * 60 * 60 * 1000,  // 3 days
  mastered: 7 * 24 * 60 * 60 * 1000,  // 7 days
};

// ─── Mastery progression ──────────────────────────────────────────────────────

/**
 * Returns the next mastery level after answering correctly or incorrectly.
 * Incorrect always resets to 'new' so the item resurfaces quickly.
 */
export function nextMastery(current: MasteryLevel, correct: boolean): MasteryLevel {
  if (!correct) return 'new';
  const progression: Record<MasteryLevel, MasteryLevel> = {
    new: 'learning',
    learning: 'mastered',
    mastered: 'mastered',
  };
  return progression[current];
}

/**
 * Returns the unix timestamp (ms) when the item should next be reviewed.
 */
export function nextReviewAt(mastery: MasteryLevel, now = Date.now()): number {
  return now + REVIEW_INTERVALS_MS[mastery];
}

/**
 * Returns true if an item is due for review right now.
 */
export function isDue(nextReview: number | null, now = Date.now()): boolean {
  if (nextReview === null) return true; // never scheduled → always due
  return nextReview <= now;
}

/**
 * Sorts items so that overdue items come first, then by how overdue they are.
 * Items with no nextReview (null) sort to the very front.
 */
export function sortByDueDate<T extends { nextReview: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.nextReview === null && b.nextReview === null) return 0;
    if (a.nextReview === null) return -1;
    if (b.nextReview === null) return 1;
    return a.nextReview - b.nextReview;
  });
}

/**
 * Shuffles an array in-place using Fisher-Yates. Returns a new array.
 */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
