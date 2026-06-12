import { getDb } from '../index';

// ─── Review history (for streaks / daily stats) ───────────────────────────────
// Deliberately no FK to saved_items: deleting an item should not erase the
// user's review history or break their streak.

export interface ReviewStats {
  reviewedToday: number;
  streakDays: number;
}

export async function logReview(itemId: number, correct: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO review_log (item_id, reviewed_at, correct) VALUES (?, ?, ?)',
    [itemId, Date.now(), correct ? 1 : 0]
  );
}

function localDayString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function getReviewStats(): Promise<ReviewStats> {
  const db = await getDb();

  const days = await db.getAllAsync<{ day: string }>(
    `SELECT DISTINCT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS day
     FROM review_log ORDER BY day DESC`
  );

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { count: reviewedToday } = (await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM review_log WHERE reviewed_at >= ?',
    [startOfToday.getTime()]
  )) ?? { count: 0 };

  // Streak: consecutive days with at least one review, ending today —
  // or ending yesterday if the user hasn't reviewed yet today.
  const daySet = new Set(days.map(d => d.day));
  let streakDays = 0;
  const cursor = new Date();
  if (!daySet.has(localDayString(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(localDayString(cursor))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { reviewedToday, streakDays };
}
