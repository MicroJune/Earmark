import { getWordsByAudioFile } from '../db/queries/words';
import { log } from '../utils/logger';

// Locates a sentence's true audio time range by matching its TEXT against the
// transcript words — instead of trusting a saved item's stored timestamps
// (which can be wrong, e.g. items saved from AI suggestions: the quoted text
// is reliable, the AI-reported times are not).
//
// Matching is done on a normalized CHARACTER stream (letters+digits only),
// not word-by-word: whisper with maxLen=1 splits contractions ("don't" →
// "don" + "'t"), and punctuation/casing differ between the displayed sentence
// and the raw word rows. A char-level substring search is immune to all of
// that. A longest-prefix fallback tolerates transcription differences near
// the end of the sentence.

const normalizeChars = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface WordTime { start: number; end: number }

interface CharIndex {
  text: string;        // concatenated normalized chars of all words
  wordAt: number[];    // wordAt[charPos] → index into times[]
  times: WordTime[];
  raw: string[];       // raw word text parallel to times[] (for debug logging)
}

// Reconstructs the transcript words covering a normalized-char range — used to
// log what audio a match will ACTUALLY play, so we can compare it to what the
// UI shows.
function spanText(index: CharIndex, fromChar: number, toChar: number): string {
  const fromWord = index.wordAt[fromChar];
  const toWord = index.wordAt[Math.min(toChar, index.wordAt.length - 1)];
  return index.raw.slice(fromWord, toWord + 1).join(' ');
}

// Cache per file — detail views often play repeatedly.
let _cacheFileId: number | null = null;
let _cacheIndex: CharIndex | null = null;

export function invalidateSentenceLocatorCache(): void {
  _cacheFileId = null;
  _cacheIndex = null;
}

async function getIndex(audioFileId: number): Promise<CharIndex> {
  if (_cacheFileId === audioFileId && _cacheIndex) return _cacheIndex;

  const words = await getWordsByAudioFile(audioFileId);
  let text = '';
  const wordAt: number[] = [];
  const times: WordTime[] = [];
  const raw: string[] = [];
  for (const w of words) {
    const chars = normalizeChars(w.word);
    if (!chars) continue;
    const idx = times.length;
    times.push({ start: w.start, end: w.end });
    raw.push(w.word);
    for (let i = 0; i < chars.length; i++) wordAt.push(idx);
    text += chars;
  }
  _cacheIndex = { text, wordAt, times, raw };
  _cacheFileId = audioFileId;
  log.debug('sentenceLocator', `index built for file ${audioFileId}: ${words.length} words → ${text.length} chars`);
  return _cacheIndex;
}

const MIN_PREFIX_CHARS = 12;

/**
 * Returns the [start, end] seconds of `sentence` within the audio file's
 * transcript, or null when even a prefix can't be located.
 */
export async function findSentenceBounds(
  audioFileId: number,
  sentence: string
): Promise<{ start: number; end: number } | null> {
  const target = normalizeChars(sentence);
  if (target.length < 3) return null;

  const index = await getIndex(audioFileId);
  if (index.text.length === 0) return null;

  // 1) Exact char-stream match of the whole sentence
  log.debug('sentenceLocator', `looking for: "${sentence.slice(0, 80)}" (normalized ${target.length} chars)`);
  const exactAt = index.text.indexOf(target);
  // Detect ambiguity: the same text appearing more than once means indexOf
  // may have picked the wrong occurrence.
  const secondAt = exactAt >= 0 ? index.text.indexOf(target, exactAt + 1) : -1;
  if (exactAt >= 0) {
    const first = index.times[index.wordAt[exactAt]];
    const last = index.times[index.wordAt[exactAt + target.length - 1]];
    log.debug('sentenceLocator', `exact match at char ${exactAt} → ${first.start.toFixed(2)}–${last.end.toFixed(2)}s | transcript span: "${spanText(index, exactAt, exactAt + target.length - 1)}"${secondAt >= 0 ? ' | text appears more than once' : ''}`);
    return { start: first.start, end: last.end };
  }

  // 2) Longest-prefix match (binary search — prefix matching is monotonic).
  //    Tolerates transcription differences later in the sentence.
  let lo = MIN_PREFIX_CHARS;
  let hi = target.length;
  if (index.text.indexOf(target.slice(0, lo)) === -1) {
    log.warn('sentenceLocator', `no match (even first ${MIN_PREFIX_CHARS} chars) for "${sentence.slice(0, 60)}"`);
    return null;
  }
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (index.text.indexOf(target.slice(0, mid)) >= 0) lo = mid;
    else hi = mid - 1;
  }
  const prefixLen = Math.min(lo, hi);
  const at = index.text.indexOf(target.slice(0, prefixLen));
  const first = index.times[index.wordAt[at]];
  const lastMatched = index.times[index.wordAt[at + prefixLen - 1]];

  // Estimate the unmatched tail's duration from the matched part's pace
  const matchedDuration = Math.max(0.5, lastMatched.end - first.start);
  const tailEstimate = ((target.length - prefixLen) / prefixLen) * matchedDuration;
  const end = lastMatched.end + Math.min(10, tailEstimate);

  log.debug('sentenceLocator', `prefix match ${prefixLen}/${target.length} chars → ${first.start.toFixed(2)}–${end.toFixed(2)}s (tail estimated) | transcript span: "${spanText(index, at, at + prefixLen - 1)}"`);
  return { start: first.start, end };
}
