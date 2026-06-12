/**
 * Formats a duration in seconds to M:SS or H:MM:SS.
 * Examples: 65 → "1:05", 3661 → "1:01:01"
 */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) {
    return `${h}:${pad(m)}:${pad(sec)}`;
  }
  return `${m}:${pad(sec)}`;
}

/**
 * Formats a playback position as M:SS or H:MM:SS (same as formatDuration).
 * Kept separate so display logic can diverge in the future (e.g. show decimals).
 */
export function formatPosition(seconds: number): string {
  return formatDuration(seconds);
}

/**
 * Formats a unix timestamp (ms) as a human-readable relative date.
 * Examples: "Today", "Yesterday", "3 days ago", "Jun 5"
 */
export function formatRelativeDate(timestampMs: number): string {
  const now = Date.now();
  const diffMs = now - timestampMs;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  const date = new Date(timestampMs);
  const month = date.toLocaleString('default', { month: 'short' });
  return `${month} ${date.getDate()}`;
}

/**
 * Formats a unix timestamp (ms) for next review display.
 * Examples: "Due now", "Due tomorrow", "Due in 3 days", "Due Jun 15"
 */
export function formatNextReview(nextReviewMs: number | null): string {
  if (nextReviewMs === null) return 'Due now';

  const now = Date.now();
  const diffMs = nextReviewMs - now;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs <= 0) return 'Due now';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays < 7) return `Due in ${diffDays} days`;

  const date = new Date(nextReviewMs);
  const month = date.toLocaleString('default', { month: 'short' });
  return `Due ${month} ${date.getDate()}`;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
