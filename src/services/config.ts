import * as SecureStore from 'expo-secure-store';

const KEYS = {
  groq: 'postcast_groq_api_key',
  anthropic: 'postcast_anthropic_api_key',
} as const;

export interface ApiKeys {
  groqApiKey: string;
  anthropicApiKey: string;
}

export async function getApiKeys(): Promise<ApiKeys | null> {
  const [storedGroq, storedAnthropic] = await Promise.all([
    SecureStore.getItemAsync(KEYS.groq),
    SecureStore.getItemAsync(KEYS.anthropic),
  ]);

  const groqApiKey = storedGroq?.trim() ?? '';
  const anthropicApiKey = storedAnthropic?.trim() ?? '';

  if (!groqApiKey) return null;
  return { groqApiKey, anthropicApiKey };
}

export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.groq, keys.groqApiKey),
    SecureStore.setItemAsync(KEYS.anthropic, keys.anthropicApiKey),
  ]);
}

export async function clearApiKeys(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.groq),
    SecureStore.deleteItemAsync(KEYS.anthropic),
  ]);
}
