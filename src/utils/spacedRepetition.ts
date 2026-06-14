import type { MasteryLevel, ReviewGrade, SrsState, SavedItem } from '../types';

// ─── SM-2 spaced repetition (4-grade) ─────────────────────────────────────────
// A pragmatic SM-2 variant. Each item carries: easeFactor (difficulty
// multiplier), intervalDays (current spacing), reviewCount (successful reps).
// A review yields one of four grades; we recompute the schedule from there.
//
// Why SM-2 over the old fixed 1/3/7-day model: intervals adapt to how well the
// user actually knows each item, and a single wrong answer no longer wipes out
// weeks of progress — it just shortens the interval and lowers the ease.

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

// Sub-day interval (in days) used when an item is "relearning" after a miss or
// is still in its first steps — keeps it coming back within the same session-ish
// window rather than disappearing for a day.
const LAPSE_INTERVAL_DAYS = 10 / (24 * 60); // 10 minutes
const HARD_FIRST_DAYS = 0.5;                  // ~12h for a shaky first recall

// Derived mastery purely for display/filtering (Library badges, stats).
export function masteryFromInterval(intervalDays: number): MasteryLevel {
  if (intervalDays >= 21) return 'mastered';
  if (intervalDays >= 1) return 'learning';
  return 'new';
}

/**
 * Computes the next SRS state from the item's current state and a review grade.
 *
 * - again: lapse. Interval collapses to minutes, ease −0.20. Progress (review
 *   count) is kept but effectively restarts the growth from a short interval.
 * - hard:  recalled with effort. Interval ×1.2, ease −0.15.
 * - good:  normal recall. Interval ×ease (with fixed early steps).
 * - easy:  effortless. Interval ×ease×1.3, ease +0.15.
 */
export function computeSrs(
  item: Pick<SavedItem, 'easeFactor' | 'intervalDays' | 'reviewCount'>,
  grade: ReviewGrade,
  now = Date.now()
): SrsState {
  let ease = item.easeFactor || 2.5;
  const prevInterval = item.intervalDays || 0;
  let reviewCount = item.reviewCount || 0;
  let interval: number;

  switch (grade) {
    case 'again':
      ease = Math.max(MIN_EASE, ease - 0.2);
      interval = LAPSE_INTERVAL_DAYS;
      // Drop back to the "still learning" steps so good answers rebuild spacing.
      reviewCount = 0;
      break;

    case 'hard':
      ease = Math.max(MIN_EASE, ease - 0.15);
      interval = reviewCount === 0 ? HARD_FIRST_DAYS : Math.max(HARD_FIRST_DAYS, prevInterval * 1.2);
      reviewCount += 1;
      break;

    case 'easy':
      ease = ease + 0.15;
      // Fixed-ish early steps, then exponential with an easy bonus.
      interval = reviewCount === 0 ? 3 : reviewCount === 1 ? 6 : prevInterval * ease * 1.3;
      reviewCount += 1;
      break;

    case 'good':
    default:
      // Classic SM-2 early steps: 1 day, then 6 days, then ×ease.
      interval = reviewCount === 0 ? 1 : reviewCount === 1 ? 6 : prevInterval * ease;
      reviewCount += 1;
      break;
  }

  const nextReview = now + Math.max(LAPSE_INTERVAL_DAYS, interval) * DAY_MS;
  return {
    easeFactor: Math.round(ease * 100) / 100,
    intervalDays: interval,
    reviewCount,
    nextReview,
    mastery: masteryFromInterval(interval),
  };
}

// ─── Scheduling helpers ───────────────────────────────────────────────────────

/** Returns true if an item is due for review right now. */
export function isDue(nextReview: number | null, now = Date.now()): boolean {
  if (nextReview === null) return true; // never scheduled → always due
  return nextReview <= now;
}

/** Rough estimate of session length in minutes from a due-item count. */
export function estimateMinutes(dueCount: number): number {
  // ~8s per card on average; round up to whole minutes, min 1.
  return Math.max(1, Math.round((dueCount * 8) / 60));
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

/** Fisher-Yates shuffle. Returns a new array. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Fuzzy answer matching (typed production) ─────────────────────────────────
// Exact-string matching punishes a learner for a stray comma, capital letter, or
// single typo — none of which mean they failed to recall the phrase. We compare
// on a normalized form and tolerate a small edit distance, returning a graded
// match so a near-miss can be scheduled as "hard" rather than "again".

/** Lowercase, strip surrounding punctuation, collapse internal whitespace. */
function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:"'`()\[\]{}…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

export type AnswerMatch = 'exact' | 'close' | 'wrong';

/**
 * Compares a typed answer against the target.
 * - 'exact': normalized forms match → grade 'good'.
 * - 'close': within a small edit distance (1 for short answers, 2 for longer)
 *   → grade 'hard'. Catches typos and minor spelling slips.
 * - 'wrong': otherwise → grade 'again'.
 */
export function matchAnswer(input: string, target: string): AnswerMatch {
  const a = normalizeAnswer(input);
  const b = normalizeAnswer(target);
  if (!a) return 'wrong';
  if (a === b) return 'exact';
  const tolerance = b.length > 8 ? 2 : 1;
  return editDistance(a, b) <= tolerance ? 'close' : 'wrong';
}
