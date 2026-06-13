import * as SecureStore from 'expo-secure-store';

const KEYS = {
  volcApiKey: 'postcast_volc_access_token',
  ark: 'postcast_ark_api_key',
  deepseek: 'postcast_deepseek_api_key',
} as const;

// Keys from removed providers/auth schemes — wiped on save/clear.
const LEGACY_KEYS = ['postcast_volc_app_id', 'postcast_anthropic_api_key'];

export interface ApiKeys {
  volcApiKey: string;       // 火山引擎语音 API Key — shared by cloud ASR + TTS
  arkApiKey: string;        // 火山方舟 API Key — AI features (separate key system from 语音)
  deepseekApiKey: string;
}

/**
 * Reads all API keys from secure storage. Always returns an object (keys may
 * be empty strings) — callers check the specific key they need. On-device
 * transcription needs no key at all, so a missing key is not a global failure.
 */
export async function getApiKeys(): Promise<ApiKeys> {
  const [volcApiKey, ark, deepseek] = await Promise.all([
    SecureStore.getItemAsync(KEYS.volcApiKey),
    SecureStore.getItemAsync(KEYS.ark),
    SecureStore.getItemAsync(KEYS.deepseek),
  ]);
  return {
    volcApiKey: volcApiKey?.trim() ?? '',
    arkApiKey: ark?.trim() ?? '',
    deepseekApiKey: deepseek?.trim() ?? '',
  };
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.volcApiKey, keys.volcApiKey),
    SecureStore.setItemAsync(KEYS.ark, keys.arkApiKey),
    SecureStore.setItemAsync(KEYS.deepseek, keys.deepseekApiKey),
    ...LEGACY_KEYS.map(k => SecureStore.deleteItemAsync(k)),
  ]);
}

export async function clearApiKeys(): Promise<void> {
  await Promise.all([
    ...Object.values(KEYS).map(k => SecureStore.deleteItemAsync(k)),
    ...LEGACY_KEYS.map(k => SecureStore.deleteItemAsync(k)),
  ]);
}
