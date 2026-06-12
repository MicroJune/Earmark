import type { SavedItem, ItemEnrichment } from '../types';

// AI learning notes for a saved item: Chinese translation, simple English
// definition, synonyms, extra example sentences, and a usage tip.
// Generated once per item via the Claude API and cached in SQLite by the
// caller — afterwards the notes are available fully offline.

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

export class EnrichmentError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

const SYSTEM_PROMPT = `You are an English learning assistant for a Chinese speaker at an intermediate level.
Given an English word, phrase, or sentence that the learner saved from a podcast (with its original context), produce concise learning notes:

- translation_zh: natural Simplified Chinese translation of the saved text (for a sentence, translate the whole sentence)
- definition_en: a simple English explanation using easy words (one sentence)
- synonyms: 2-4 similar words or phrases the learner could use instead (English; for sentences give alternative ways to express the same idea)
- examples: 2 NEW example sentences (different from the original context) showing typical usage, each with a Chinese translation
- tip: one short usage note, common mistake to avoid, or memory hook (English, optionally with Chinese)

Keep everything short and practical for vocabulary review cards.`;

const ENRICH_TOOL = {
  name: 'save_learning_notes',
  description: 'Save the learning notes for the item',
  input_schema: {
    type: 'object',
    properties: {
      translation_zh: { type: 'string' },
      definition_en:  { type: 'string' },
      synonyms:       { type: 'array', items: { type: 'string' } },
      examples: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            en: { type: 'string' },
            zh: { type: 'string' },
          },
          required: ['en', 'zh'],
        },
      },
      tip: { type: 'string' },
    },
    required: ['translation_zh', 'definition_en', 'synonyms', 'examples'],
  },
};

/**
 * Generates learning notes for a saved item via the Claude API.
 * Pure network call — caching is the caller's responsibility.
 */
export async function generateEnrichment(
  item: Pick<SavedItem, 'text' | 'contextSentence' | 'type'>,
  anthropicApiKey: string
): Promise<ItemEnrichment> {
  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    tools: [ENRICH_TOOL],
    tool_choice: { type: 'tool', name: 'save_learning_notes' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' }, // identical across calls
      },
    ],
    messages: [
      {
        role: 'user',
        content:
          `Saved ${item.type}: "${item.text}"\n` +
          `Original context from the podcast: "${item.contextSentence}"`,
      },
    ],
  };

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': anthropicApiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new EnrichmentError(
      err?.error?.message ?? `Claude API error (HTTP ${response.status})`,
      response.status
    );
  }

  const data = await response.json();
  const toolUse = data.content?.find(
    (block: { type: string }) => block.type === 'tool_use'
  );
  if (!toolUse?.input) throw new EnrichmentError('Claude returned no learning notes');

  const input = toolUse.input as {
    translation_zh: string;
    definition_en: string;
    synonyms: string[];
    examples: Array<{ en: string; zh: string }>;
    tip?: string;
  };

  return {
    translationZh: input.translation_zh,
    definitionEn: input.definition_en,
    synonyms: input.synonyms ?? [],
    examples: input.examples ?? [],
    tip: input.tip,
  };
}
