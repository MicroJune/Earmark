import type { Segment, Word } from '../types';

// ─── Raw API response types (Groq / OpenAI Whisper compatible) ────────────────

export interface WhisperWord {
  word: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: WhisperWord[];
}

export interface WhisperApiResponse {
  text: string;
  segments: WhisperSegment[];
  words?: WhisperWord[];
}

// ─── Parsed output types ──────────────────────────────────────────────────────

// Words carry segmentIndex (not segmentId) because DB ids are not known yet.
// The service layer resolves segmentIndex → real segmentId after inserting segments.
export type ParsedWord = Omit<Word, 'id' | 'audioFileId' | 'segmentId'> & {
  segmentIndex: number;
};

export type ParsedSegment = Omit<Segment, 'id' | 'audioFileId'>;

export interface ParsedTranscript {
  segments: ParsedSegment[];
  words: ParsedWord[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Converts a raw Whisper API response (Groq or OpenAI) into typed segments and
 * words aligned to our internal data model. Does not touch the database.
 *
 * Word-to-segment assignment: each word is assigned to the segment whose time
 * range contains its start time. Words that fall outside all segment ranges
 * are assigned to the nearest segment.
 */
export function buildParsedTranscript(response: WhisperApiResponse): ParsedTranscript {
  // Prefer top-level words array; fall back to flattening from segments.
  const rawWords: WhisperWord[] = response.words?.length
    ? response.words
    : response.segments.flatMap(seg => seg.words ?? []);

  const segments: ParsedSegment[] = [];
  const words: ParsedWord[] = [];

  // Build a word-index lookup keyed by approximate start time for fast segment assignment.
  // We iterate words once and assign each to its segment in O(n) total.
  let wordCursor = 0;

  for (let segIdx = 0; segIdx < response.segments.length; segIdx++) {
    const seg = response.segments[segIdx];
    const isLastSeg = segIdx === response.segments.length - 1;

    const wordStartIndex = wordCursor;

    while (wordCursor < rawWords.length) {
      const w = rawWords[wordCursor];
      // Assign word to this segment if its start falls within the segment,
      // or (for the last segment) if we've run out of remaining segments.
      const belongsHere = isLastSeg || w.start < response.segments[segIdx + 1].start;
      if (!belongsHere) break;

      words.push({
        wordIndex: wordCursor,
        segmentIndex: segIdx,
        word: w.word.trim(),
        start: w.start,
        end: w.end,
      });
      wordCursor++;
    }

    const wordEndIndex = wordCursor - 1;

    segments.push({
      segmentIndex: segIdx,
      text: seg.text.trim(),
      start: seg.start,
      end: seg.end,
      wordStartIndex,
      wordEndIndex: Math.max(wordStartIndex, wordEndIndex),
    });
  }

  return { segments, words };
}

/**
 * Resolves segmentIndex → real DB segmentId after segments have been inserted.
 * `segmentIds[i]` must be the DB id of the segment at index i.
 */
export function resolveSegmentIds(
  words: ParsedWord[],
  segmentIds: number[]
): Omit<Word, 'id' | 'audioFileId'>[] {
  return words.map(w => ({
    wordIndex: w.wordIndex,
    segmentId: segmentIds[w.segmentIndex],
    word: w.word,
    start: w.start,
    end: w.end,
  }));
}
