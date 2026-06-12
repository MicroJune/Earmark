import type { Segment, Word } from '../types';

// Whisper "segments" are arbitrary ~30s chunks, not sentences — they routinely
// break mid-sentence, which reads terribly. This module rebuilds the display
// transcript: punctuation from segment text is mapped back onto the words
// (engines often strip it from word-level timestamps), then the word stream is
// regrouped into sentence-level paragraphs.

// Sentence-ending punctuation, optionally followed by closing quotes/brackets.
const SENTENCE_END = /[.!?…]["'""'')\]]*$/;

// Safety valve for transcripts with sparse punctuation: force a break so a
// single "sentence" can't grow unboundedly.
const MAX_SENTENCE_WORDS = 60;

// If splitting found so little punctuation that "sentences" average longer
// than this, the engine probably doesn't emit punctuation — keep the
// original whisper segments instead.
const FALLBACK_AVG_WORDS = 50;

const stripPunct = (s: string) => s.replace(/[^A-Za-z0-9']/g, '').toLowerCase();

// Word-level timestamps usually come without punctuation, but the segment
// text has it. When a segment's text tokenizes 1:1 onto its word range,
// adopt the punctuated tokens as the words' display text.
function enrichWordsWithPunctuation(words: Word[], segments: Segment[]): Word[] {
  const out = words.slice();

  for (const seg of segments) {
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    const from = seg.wordStartIndex;
    const to = seg.wordEndIndex;
    if (to - from + 1 !== tokens.length) continue; // can't align — leave as-is

    for (let i = from; i <= to; i++) {
      const w = out[i];
      if (!w || w.wordIndex !== i) break; // defensive: index mismatch
      const token = tokens[i - from];
      // Adopt the token only when it's the same word plus punctuation —
      // guards against misalignment.
      if (token !== w.word && stripPunct(token) === stripPunct(w.word)) {
        out[i] = { ...w, word: token };
      }
    }
  }
  return out;
}

function splitIntoSentences(
  audioFileId: number,
  words: Word[],
  fallback: Segment[]
): Segment[] {
  const sentences: Segment[] = [];
  let startIdx = 0;

  for (let i = 0; i < words.length; i++) {
    const isLast = i === words.length - 1;
    const isBreak =
      isLast ||
      SENTENCE_END.test(words[i].word) ||
      i - startIdx + 1 >= MAX_SENTENCE_WORDS;
    if (!isBreak) continue;

    const slice = words.slice(startIdx, i + 1);
    sentences.push({
      id: sentences.length + 1, // synthetic — display-only, never persisted
      audioFileId,
      segmentIndex: sentences.length,
      text: slice.map(w => w.word).join(' '),
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      wordStartIndex: slice[0].wordIndex,
      wordEndIndex: slice[slice.length - 1].wordIndex,
    });
    startIdx = i + 1;
  }

  if (sentences.length <= 1 || words.length / sentences.length > FALLBACK_AVG_WORDS) {
    return fallback;
  }
  return sentences;
}

export interface DisplayTranscript {
  words: Word[];
  segments: Segment[];
}

/**
 * Builds the display version of a transcript from raw DB rows:
 * punctuation-enriched words grouped into sentence-level segments.
 * Falls back to the original whisper segments when the engine's output
 * doesn't carry enough punctuation to split sentences reliably.
 */
export function prepareDisplayTranscript(
  audioFileId: number,
  words: Word[],
  segments: Segment[]
): DisplayTranscript {
  if (words.length === 0) return { words, segments };
  const enriched = enrichWordsWithPunctuation(words, segments);
  return {
    words: enriched,
    segments: splitIntoSentences(audioFileId, enriched, segments),
  };
}
