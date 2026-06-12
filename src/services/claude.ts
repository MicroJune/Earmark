import type { PhraseSuggestion, Segment } from '../types';
import {
  getCachedSuggestions,
  setCachedSuggestions,
} from '../db/queries/suggestionCache';

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_SUGGESTIONS = 15;

// ─── Error ────────────────────────────────────────────────────────────────────

export class ClaudeError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'ClaudeError';
  }
}

// ─── System prompt (cached on Anthropic's side) ───────────────────────────────

const SYSTEM_PROMPT = `You are an English learning assistant helping a Chinese speaker who is at an intermediate level.
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

Return between 5 and ${MAX_SUGGESTIONS} phrases. For each, include:
- The exact phrase text as it appears in the transcript
- The full sentence it appears in (context_sentence)
- The start and end time of the containing segment (in seconds)
- A brief reason (1 sentence) why this phrase is useful to learn`;

// ─── Tool schema for structured output ───────────────────────────────────────

const SUGGEST_PHRASES_TOOL = {
  name: 'suggest_phrases',
  description: 'Return a list of phrases from the transcript worth learning',
  input_schema: {
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

// ─── Transcript formatter ─────────────────────────────────────────────────────

function formatTranscriptForPrompt(segments: Segment[]): string {
  return segments
    .map(seg => {
      const start = formatTime(seg.start);
      const end = formatTime(seg.end);
      return `[${start}-${end}] ${seg.text}`;
    })
    .join('\n');
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

// ─── API call ─────────────────────────────────────────────────────────────────

async function callClaudeApi(
  segments: Segment[],
  apiKey: string
): Promise<PhraseSuggestion[]> {
  const transcript = formatTranscriptForPrompt(segments);

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    tools: [SUGGEST_PHRASES_TOOL],
    tool_choice: { type: 'tool', name: 'suggest_phrases' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // prompt caching — system prompt is identical across calls
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Here is the podcast transcript. Identify the most useful phrases for an intermediate English learner:\n\n${transcript}`,
      },
    ],
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new ClaudeError(
      err?.error?.message ?? `Claude API error (HTTP ${response.status})`,
      response.status
    );
  }

  const data = await response.json();

  // Extract the tool_use block from the response
  const toolUse = data.content?.find(
    (block: { type: string }) => block.type === 'tool_use'
  );
  if (!toolUse) throw new ClaudeError('Claude returned no phrase suggestions');

  const phrases = toolUse.input?.phrases as Array<{
    text: string;
    context_sentence: string;
    start_time: number;
    end_time: number;
    reason: string;
  }>;

  return phrases.map(p => ({
    text: p.text,
    contextSentence: p.context_sentence,
    startTime: p.start_time,
    endTime: p.end_time,
    reason: p.reason,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns AI-suggested phrases for a transcript.
 * Checks the SQLite cache first — the API is only called once per audio file.
 */
export async function getPhraseSuggestions(
  audioFileId: number,
  segments: Segment[],
  anthropicApiKey: string
): Promise<PhraseSuggestion[]> {
  const cached = await getCachedSuggestions(audioFileId);
  if (cached) return cached;

  const suggestions = await callClaudeApi(segments, anthropicApiKey);
  await setCachedSuggestions(audioFileId, suggestions);
  return suggestions;
}

/**
 * Clears the cached suggestions for a file, forcing a fresh API call next time.
 * Useful if the user wants regenerated suggestions.
 */
export { deleteCachedSuggestions as clearPhraseSuggestions } from '../db/queries/suggestionCache';
