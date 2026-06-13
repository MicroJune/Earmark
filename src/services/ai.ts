import { getApiKeys } from './config';
import { getSettings, type AiProvider } from './settings';

// Unified AI adapter for the app's structured-output features (phrase
// suggestions, learning notes). Supports two providers:
//   - 豆包 (火山方舟 Ark)  — ByteDance LLM, China-accessible; NOTE: the Ark API
//                            Key is a separate key from the 豆包语音 API Key
//   - DeepSeek             — China-accessible, OpenAI-compatible, very cheap
// Both are OpenAI-compatible chat-completions APIs driven via forced
// tool/function calling so the model returns a validated JSON object
// matching `schema`.

const ARK_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
// Cheap + fast Doubao tier — fine for phrase extraction. Must be enabled in
// the Ark console (开通管理) before first use.
const ARK_MODEL = 'doubao-seed-1-6-flash-250615';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

export class AiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'AiError';
  }
}

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input (object). */
  parameters: Record<string, unknown>;
}

export interface AiCredentials {
  provider: AiProvider;
  apiKey: string;
}

/**
 * Resolves the active AI provider and its API key from settings + secure
 * storage. Throws a clear, localized-friendly error if no key is configured.
 */
export async function getAiCredentials(): Promise<AiCredentials> {
  const [{ aiProvider }, keys] = await Promise.all([getSettings(), getApiKeys()]);
  if (aiProvider === 'deepseek') {
    if (!keys.deepseekApiKey) {
      throw new AiError('需要 DeepSeek API key — 在设置里填写（platform.deepseek.com 注册）。AI features need a DeepSeek API key (set it in Settings).');
    }
    return { provider: 'deepseek', apiKey: keys.deepseekApiKey };
  }
  if (!keys.arkApiKey) {
    throw new AiError('需要火山方舟 API Key — 在 console.volcengine.com/ark 创建并填入设置(注意:方舟 key 与语音 key 不是同一个)。或把 AI provider 切换到 DeepSeek。');
  }
  return { provider: 'volcano', apiKey: keys.arkApiKey };
}

/**
 * Calls the active provider forcing a single tool/function call, and returns
 * the parsed tool input object. `creds` is optional — resolved from settings
 * when omitted.
 */
export async function callAiTool<T>(
  systemPrompt: string,
  userMessage: string,
  tool: AiToolSpec,
  maxTokens: number,
  creds?: AiCredentials
): Promise<T> {
  const c = creds ?? (await getAiCredentials());
  return c.provider === 'deepseek'
    ? callOpenAiCompatible<T>(DEEPSEEK_URL, DEEPSEEK_MODEL, 'DeepSeek', systemPrompt, userMessage, tool, maxTokens, c.apiKey)
    : callOpenAiCompatible<T>(ARK_URL, ARK_MODEL, '豆包(方舟)', systemPrompt, userMessage, tool, maxTokens, c.apiKey);
}

// ─── OpenAI-compatible chat completions (Ark + DeepSeek) ─────────────────────

async function callOpenAiCompatible<T>(
  url: string,
  model: string,
  providerLabel: string,
  systemPrompt: string,
  userMessage: string,
  tool: AiToolSpec,
  maxTokens: number,
  apiKey: string
): Promise<T> {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    tools: [{
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }],
    tool_choice: { type: 'function', function: { name: tool.name } },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new AiError(
      err?.error?.message ?? `${providerLabel} API error (HTTP ${response.status})`,
      response.status
    );
  }

  const data = await response.json();
  const call = data.choices?.[0]?.message?.tool_calls?.[0];
  const argsJson = call?.function?.arguments;
  if (!argsJson) throw new AiError(`${providerLabel} returned no structured result`);
  try {
    return JSON.parse(argsJson) as T;
  } catch {
    throw new AiError(`${providerLabel} returned malformed JSON`);
  }
}
