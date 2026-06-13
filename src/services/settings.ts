import Storage from 'expo-sqlite/kv-store';
import { isLocalEngineSupported } from './transcription/support';

// ─── App settings (persisted key-value, no API keys here) ─────────────────────

export type TranscriptionEngine = 'local' | 'cloud';
export type WhisperModelName = 'tiny.en' | 'base.en' | 'small.en';
export type ModelMirror = 'huggingface' | 'hf-mirror';
export type AiProvider = 'volcano' | 'deepseek';
export type SuggestionDensity = 'low' | 'medium' | 'high';

const KEYS = {
  engine: 'settings_transcription_engine',
  model: 'settings_whisper_model',
  mirror: 'settings_model_mirror',
  aiProvider: 'settings_ai_provider',
  aiEnabled: 'settings_ai_enabled',
  suggestionDensity: 'settings_suggestion_density',
} as const;

// Default to the offline engine only when its native modules are actually
// present (development/production build). In Expo Go, default to cloud.
const DEFAULTS = {
  get engine(): TranscriptionEngine {
    return isLocalEngineSupported() ? 'local' : 'cloud';
  },
  model: 'base.en' as WhisperModelName,
  mirror: 'huggingface' as ModelMirror,
  aiProvider: 'volcano' as AiProvider,
};

export interface AppSettings {
  transcriptionEngine: TranscriptionEngine;
  whisperModel: WhisperModelName;
  modelMirror: ModelMirror;
  aiProvider: AiProvider;
  aiEnabled: boolean;
}

export async function getSettings(): Promise<AppSettings> {
  const [engine, model, mirror, aiProvider, aiEnabled] = await Promise.all([
    Storage.getItem(KEYS.engine),
    Storage.getItem(KEYS.model),
    Storage.getItem(KEYS.mirror),
    Storage.getItem(KEYS.aiProvider),
    Storage.getItem(KEYS.aiEnabled),
  ]);
  return {
    transcriptionEngine: (engine as TranscriptionEngine) ?? DEFAULTS.engine,
    whisperModel: (model as WhisperModelName) ?? DEFAULTS.model,
    modelMirror: (mirror as ModelMirror) ?? DEFAULTS.mirror,
    // Legacy stored value 'claude' (provider removed) maps to the default.
    aiProvider: aiProvider === 'deepseek' ? 'deepseek' : DEFAULTS.aiProvider,
    // Default ON so existing setups keep auto-generating notes; the AI page
    // simply offers a kill switch.
    aiEnabled: aiEnabled !== 'false',
  };
}

export async function setTranscriptionEngine(engine: TranscriptionEngine): Promise<void> {
  await Storage.setItem(KEYS.engine, engine);
}

export async function setWhisperModel(model: WhisperModelName): Promise<void> {
  await Storage.setItem(KEYS.model, model);
}

export async function setModelMirror(mirror: ModelMirror): Promise<void> {
  await Storage.setItem(KEYS.mirror, mirror);
}

export async function setAiProvider(provider: AiProvider): Promise<void> {
  await Storage.setItem(KEYS.aiProvider, provider);
}

export async function setAiEnabled(enabled: boolean): Promise<void> {
  await Storage.setItem(KEYS.aiEnabled, String(enabled));
}

// How file lists inside a category are ordered.
export type FileSortMode = 'manual' | 'name' | 'date' | 'size';

export async function getFileSortMode(): Promise<FileSortMode> {
  const v = await Storage.getItem('settings_file_sort');
  return v === 'manual' || v === 'name' || v === 'size' ? v : 'date';
}

export async function setFileSortMode(mode: FileSortMode): Promise<void> {
  await Storage.setItem('settings_file_sort', mode);
}

export async function getSuggestionDensity(): Promise<SuggestionDensity> {
  const v = await Storage.getItem(KEYS.suggestionDensity);
  return v === 'low' || v === 'high' ? v : 'medium';
}

export async function setSuggestionDensity(density: SuggestionDensity): Promise<void> {
  await Storage.setItem(KEYS.suggestionDensity, density);
}

// Synchronous mirror base lookup for the model downloader. hf-mirror.com is a
// well-known Hugging Face mirror that is reachable from mainland China, where
// huggingface.co is blocked.
const MIRROR_BASES: Record<ModelMirror, string> = {
  'huggingface': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main',
  'hf-mirror':   'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main',
};

export async function getModelMirrorBase(): Promise<string> {
  const mirror = (await Storage.getItem(KEYS.mirror)) as ModelMirror | null;
  return MIRROR_BASES[mirror ?? DEFAULTS.mirror];
}
