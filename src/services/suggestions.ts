import type { PhraseSuggestion, Segment } from '../types';
import {
  getCachedSuggestions,
  setCachedSuggestions,
} from '../db/queries/suggestionCache';
import { getSuggestionDensity, type SuggestionDensity } from './settings';
import { callAiTool, type AiToolSpec } from './ai';

// AI-suggested phrases worth learning from a transcript, via the active AI
// provider (豆包/方舟 or DeepSeek). Cached per audio file in SQLite.

export class SuggestionsError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'SuggestionsError';
  }
}

// Phrases per minute of audio for each user-selected density level. A single
// API call can return ~45 phrases at most (output token limit), so the target
// is capped — "find more" (refresh) appends further batches on demand.
const DENSITY_RATES: Record<SuggestionDensity, number> = {
  low: 2,
  medium: 8,
  high: 14,
};
const MIN_SUGGESTIONS = 5;
const MAX_PER_CALL = 45;

function targetCount(segments: Segment[], density: SuggestionDensity): number {
  const durationMinutes = segments.length > 0
    ? segments[segments.length - 1].end / 60
    : 0;
  const ideal = Math.round(durationMinutes * DENSITY_RATES[density]);
  return Math.max(MIN_SUGGESTIONS, Math.min(MAX_PER_CALL, ideal));
}

function buildSystemPrompt(target: number, excludeTexts: string[]): string {
  const exclusion = excludeTexts.length > 0
    ? `\nThe user has ALREADY SEEN or saved these phrases — do NOT suggest any of them again (find different ones):\n${excludeTexts.map(t => `- ${t}`).join('\n')}\n`
    : '';
  return `You are an English learning assistant helping a Chinese speaker who is at an intermediate level.
Your job is to identify phrases from podcast transcripts that are genuinely worth learning.

Focus on:
- Idiomatic expressions and phrasal verbs (e.g. "pull it off", "on the fence")
- Natural spoken collocations (e.g. "a steep learning curve", "at the end of the day")
- Useful discourse markers and connectors (e.g. "to be fair", "having said that")
- Common fixed expressions in spoken English (e.g. "it turns out", "no wonder")

Avoid:
- Single common words the user likely already knows
- Highly technical jargon specific to a niche field
- Proper nouns and brand names
- Phrases too advanced for an intermediate learner
${exclusion}
IMPORTANT: Scan the ENTIRE transcript from beginning to end and spread your
picks evenly across the whole episode — do not cluster them in the opening
minutes. Aim for ${target} phrases; if the transcript genuinely doesn't
contain that many suitable ones, return fewer rather than padding with weak picks.

For each phrase, include:
- The exact phrase text as it appears in the transcript
- The full sentence it appears in (context_sentence)
- The start and end time of the containing segment (in seconds)
- A brief reason (1 sentence) why this phrase is useful to learn`;
}

const SUGGEST_PHRASES_TOOL: AiToolSpec = {
  name: 'suggest_phrases',
  description: 'Return a list of phrases from the transcript worth learning',
  parameters: {
    type: 'object',
    properties: {
      phrases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text:             { type: 'string', description: 'The phrase as it appears in the transcript' },
            context_sentence: { type: 'string', description: 'The full sentence containing the phrase' },
            start_time:       { type: 'number', description: 'Start time of the segment in seconds' },
            end_time:         { type: 'number', description: 'End time of the segment in seconds' },
            reason:           { type: 'string', description: 'One sentence: why this phrase is useful to learn' },
          },
          required: ['text', 'context_sentence', 'start_time', 'end_time', 'reason'],
        },
      },
    },
    required: ['phrases'],
  },
};

function formatTranscriptForPrompt(segments: Segment[]): string {
  return segments
    .map(seg => `[${formatTime(seg.start)}-${formatTime(seg.end)}] ${seg.text}`)
    .join('\n');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

interface SuggestInput {
  phrases: Array<{
    text: string;
    context_sentence: string;
    start_time: number;
    end_time: number;
    reason: string;
  }>;
}

async function callApi(
  segments: Segment[],
  density: SuggestionDensity,
  excludeTexts: string[]
): Promise<PhraseSuggestion[]> {
  const transcript = formatTranscriptForPrompt(segments);
  const target = targetCount(segments, density);
  const userMessage =
    `Here is the podcast transcript. Identify the ~${target} most useful phrases for an intermediate English learner, covering the whole episode:\n\n${transcript}`;

  let input: SuggestInput;
  try {
    // ~150 output tokens per phrase; cap below DeepSeek's 8192 output limit.
    const maxTokens = Math.min(8000, 1500 + target * 160);
    input = await callAiTool<SuggestInput>(
      buildSystemPrompt(target, excludeTexts), userMessage, SUGGEST_PHRASES_TOOL, maxTokens
    );
  } catch (e) {
    throw new SuggestionsError(e instanceof Error ? e.message : 'Failed to get phrase suggestions');
  }

  return (input.phrases ?? []).map(p => ({
    text: p.text,
    contextSentence: p.context_sentence,
    startTime: p.start_time,
    endTime: p.end_time,
    reason: p.reason,
  }));
}

/**
 * Returns AI-suggested phrases for a transcript.
 * Checks the SQLite cache first — the API is only called when nothing is cached.
 */
export async function getPhraseSuggestions(
  audioFileId: number,
  segments: Segment[]
): Promise<PhraseSuggestion[]> {
  const cached = await getCachedSuggestions(audioFileId);
  if (cached) return cached;

  const density = await getSuggestionDensity();
  const suggestions = await callApi(segments, density, []);
  await setCachedSuggestions(audioFileId, suggestions);
  return suggestions;
}

/**
 * "Find more": asks the AI for ANOTHER batch of phrases, explicitly excluding
 * everything already suggested (and anything in `extraExclude`, e.g. items the
 * user saved manually). New phrases are appended to the cache; returns the
 * combined list. Returns the same list when the AI finds nothing new.
 */
export async function fetchMoreSuggestions(
  audioFileId: number,
  segments: Segment[],
  extraExclude: string[] = []
): Promise<PhraseSuggestion[]> {
  const existing = (await getCachedSuggestions(audioFileId)) ?? [];
  const density = await getSuggestionDensity();

  const seen = new Set(existing.map(s => s.text.toLowerCase()));
  const exclude = [
    ...existing.map(s => s.text),
    ...extraExclude.filter(t => !seen.has(t.toLowerCase())),
  ];

  const fresh = await callApi(segments, density, exclude);
  // Defensive dedupe — models occasionally repeat an excluded phrase anyway.
  const newOnes = fresh.filter(s => !seen.has(s.text.toLowerCase()));

  const combined = [...existing, ...newOnes];
  await setCachedSuggestions(audioFileId, combined);
  return combined;
}
