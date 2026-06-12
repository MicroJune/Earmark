import Storage from 'expo-sqlite/kv-store';
import { isLocalEngineSupported } from './transcription/support';

// ─── App settings (persisted key-value, no API keys here) ─────────────────────

export type TranscriptionEngine = 'local' | 'cloud';
export type WhisperModelName = 'tiny.en' | 'base.en' | 'small.en';

const KEYS = {
  engine: 'settings_transcription_engine',
  model: 'settings_whisper_model',
} as const;

// Default to the offline engine only when its native modules are actually
// present (development/production build). In Expo Go, default to cloud.
const DEFAULTS = {
  get engine(): TranscriptionEngine {
    return isLocalEngineSupported() ? 'local' : 'cloud';
  },
  model: 'base.en' as WhisperModelName,
};

export interface AppSettings {
  transcriptionEngine: TranscriptionEngine;
  whisperModel: WhisperModelName;
}

export async function getSettings(): Promise<AppSettings> {
  const [engine, model] = await Promise.all([
    Storage.getItem(KEYS.engine),
    Storage.getItem(KEYS.model),
  ]);
  return {
    transcriptionEngine: (engine as TranscriptionEngine) ?? DEFAULTS.engine,
    whisperModel: (model as WhisperModelName) ?? DEFAULTS.model,
  };
}

export async function setTranscriptionEngine(engine: TranscriptionEngine): Promise<void> {
  await Storage.setItem(KEYS.engine, engine);
}

export async function setWhisperModel(model: WhisperModelName): Promise<void> {
  await Storage.setItem(KEYS.model, model);
}
