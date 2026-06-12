import type { ParsedTranscript, ParsedSegment, ParsedWord } from '../../utils/transcriptBuilder';
import type { WhisperModelName } from '../settings';
import { getModelPath, isModelDownloaded, getModelInfo } from './models';
import { decodeToWhisperWav, deleteTempWav } from './audioDecoder';
import { log } from '../../utils/logger';

// ─── On-device Whisper (whisper.cpp via whisper.rn) ───────────────────────────
// Runs fully offline once a model is downloaded. whisper.rn is a native module,
// so it is require()d lazily — the app still runs in Expo Go as long as the
// local engine is not used.

export class LocalWhisperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalWhisperError';
  }
}

function loadWhisperRn(): any {
  let mod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('whisper.rn');
  } catch {
    // fall through to the check below
  }
  // In Expo Go the JS module may load but its native bindings are absent —
  // verify the API actually exists.
  if (typeof mod?.initWhisper !== 'function') {
    throw new LocalWhisperError(
      'On-device transcription is not available in Expo Go — it needs the development build of this app ' +
      '(see OFFLINE_SETUP.md). Until then, switch to the Cloud engine in Settings.'
    );
  }
  return mod;
}

// ─── Context cache ────────────────────────────────────────────────────────────
// Loading a model takes seconds; keep one context alive per model.

let _context: any | null = null;
let _contextModel: WhisperModelName | null = null;

async function getWhisperContext(model: WhisperModelName): Promise<any> {
  if (_context && _contextModel === model) return _context;

  if (_context) {
    try { await _context.release(); } catch {}
    _context = null;
    _contextModel = null;
  }

  if (!(await isModelDownloaded(model))) {
    throw new LocalWhisperError(
      `The "${getModelInfo(model).label}" model is not downloaded yet. Download it in Settings first.`
    );
  }

  const { initWhisper } = loadWhisperRn();
  log.info('localWhisper', `loading model ${model}`);
  _context = await initWhisper({ filePath: getModelPath(model) });
  _contextModel = model;
  return _context;
}

export async function releaseWhisperContext(): Promise<void> {
  if (_context) {
    try { await _context.release(); } catch {}
    _context = null;
    _contextModel = null;
  }
}

// ─── Sentence grouping ────────────────────────────────────────────────────────
// With maxLen=1 + tokenTimestamps, whisper.cpp emits one segment per word.
// We rebuild sentence-level segments (for loop/shadowing) from punctuation.

const SENTENCE_END = /[.!?…]["')\]]?$/;
const MAX_SEGMENT_CHARS = 200;

interface TimedWord { word: string; start: number; end: number }

export function groupWordsIntoSentences(timedWords: TimedWord[]): ParsedTranscript {
  const segments: ParsedSegment[] = [];
  const words: ParsedWord[] = [];

  let segStartWord = 0;
  let segText = '';

  const flushSegment = () => {
    if (segStartWord >= words.length) return;
    const segIdx = segments.length;
    const first = words[segStartWord];
    const last = words[words.length - 1];
    for (let i = segStartWord; i < words.length; i++) words[i].segmentIndex = segIdx;
    segments.push({
      segmentIndex: segIdx,
      text: segText.trim(),
      start: first.start,
      end: last.end,
      wordStartIndex: segStartWord,
      wordEndIndex: words.length - 1,
    });
    segStartWord = words.length;
    segText = '';
  };

  for (const tw of timedWords) {
    const text = tw.word.trim();
    if (!text) continue;

    words.push({
      wordIndex: words.length,
      segmentIndex: -1, // patched by flushSegment
      word: text,
      start: tw.start,
      end: tw.end,
    });
    segText += (segText ? ' ' : '') + text;

    if (SENTENCE_END.test(text) || segText.length >= MAX_SEGMENT_CHARS) {
      flushSegment();
    }
  }
  flushSegment();

  return { segments, words };
}

// ─── Transcription ────────────────────────────────────────────────────────────

export interface LocalTranscriptionOptions {
  language?: string;
  onProgress?: (fraction: number) => void; // 0..1, decode + transcribe combined
}

/**
 * Transcribes an audio file fully on-device and returns a ParsedTranscript
 * with word-level timestamps. Pure function — does not touch the database.
 */
export async function transcribeAudioLocally(
  uri: string,
  model: WhisperModelName,
  options: LocalTranscriptionOptions = {}
): Promise<ParsedTranscript> {
  const { language = 'en', onProgress } = options;

  // Phase 1 (~0–10%): decode to 16 kHz mono wav
  onProgress?.(0.02);
  const wavUri = await decodeToWhisperWav(uri);
  onProgress?.(0.1);

  try {
    const context = await getWhisperContext(model);

    log.info('localWhisper', `transcribing ${wavUri}`);
    const { promise } = context.transcribe(wavUri, {
      language,
      // One segment per word — the standard whisper.cpp way to get
      // word-level timestamps. Sentences are rebuilt afterwards.
      maxLen: 1,
      tokenTimestamps: true,
      onProgress: (p: number) => onProgress?.(0.1 + (p / 100) * 0.9),
    });

    const result = await promise;
    if (result.isAborted) throw new LocalWhisperError('Transcription was aborted');

    const timedWords = (result.segments ?? []).map(
      (s: { text: string; t0: number; t1: number }) => ({
        word: s.text,
        // t0/t1 are in centiseconds (10 ms units)
        start: s.t0 / 100,
        end: s.t1 / 100,
      })
    );

    const parsed = groupWordsIntoSentences(timedWords);
    if (parsed.words.length === 0) {
      throw new LocalWhisperError('No speech was detected in this file');
    }

    log.info(
      'localWhisper',
      `done: ${parsed.segments.length} sentences, ${parsed.words.length} words`
    );
    onProgress?.(1);
    return parsed;
  } finally {
    deleteTempWav(wavUri);
  }
}
