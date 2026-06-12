/**
 * Finds the index of the last word whose start time is <= position.
 * Returns -1 if position is before the first word.
 * O(log n) — safe for transcripts with thousands of words.
 */
export function findActiveWordIndex(
  startTimes: Float64Array,
  position: number
): number {
  let lo = 0, hi = startTimes.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (startTimes[mid] <= position) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}

/**
 * Generic sorted-array binary search.
 * Returns the index of the last element where predicate(element) is true.
 * Returns -1 if no element satisfies the predicate.
 *
 * Useful for any monotonic search beyond word timestamps.
 */
export function binarySearchLast<T>(
  arr: T[],
  predicate: (item: T) => boolean
): number {
  let lo = 0, hi = arr.length - 1, result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (predicate(arr[mid])) { result = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return result;
}
