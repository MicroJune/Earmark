import type { SavedItem, ItemEnrichment } from '../types';
import { callAiTool, type AiToolSpec } from './ai';

// AI learning notes for a saved item: Chinese translation, simple English
// definition, synonyms, extra example sentences, and a usage tip.
// Generated once per item via the active AI provider (豆包/方舟 or DeepSeek) and
// cached in SQLite by the caller — afterwards the notes are available offline.

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

const ENRICH_TOOL: AiToolSpec = {
  name: 'save_learning_notes',
  description: 'Save the learning notes for the item',
  parameters: {
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

interface EnrichInput {
  translation_zh: string;
  definition_en: string;
  synonyms: string[];
  examples: Array<{ en: string; zh: string }>;
  tip?: string;
}

/**
 * Generates learning notes for a saved item via the active AI provider.
 * Pure network call — caching is the caller's responsibility.
 */
export async function generateEnrichment(
  item: Pick<SavedItem, 'text' | 'contextSentence' | 'type'>
): Promise<ItemEnrichment> {
  const userMessage =
    `Saved ${item.type}: "${item.text}"\n` +
    `Original context from the podcast: "${item.contextSentence}"`;

  let input: EnrichInput;
  try {
    input = await callAiTool<EnrichInput>(SYSTEM_PROMPT, userMessage, ENRICH_TOOL, 1024);
  } catch (e) {
    throw new EnrichmentError(e instanceof Error ? e.message : 'Failed to generate learning notes');
  }

  return {
    translationZh: input.translation_zh,
    definitionEn: input.definition_en,
    synonyms: input.synonyms ?? [],
    examples: input.examples ?? [],
    tip: input.tip,
  };
}
