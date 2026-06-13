import * as Speech from 'expo-speech';
import Storage from 'expo-sqlite/kv-store';
import {
  synthesizeToFile, getVolcanoCredentials, DEFAULT_VOLCANO_VOICE,
} from './volcano';
import { togglePreview, stopPreview } from './audio';
import { log } from '../utils/logger';

// ─── Text-to-speech ───────────────────────────────────────────────────────────
// Two providers, chosen in Settings:
//   - 'volcano' (default): 豆包语音合成 — dictionary-quality neural voices.
//     Online for the first playback of each text, then served from the disk
//     cache (offline). Falls back to the system engine on any failure, so the
//     speak buttons always work.
//   - 'system': the device TTS engine via expo-speech (fully offline).

const KEYS = {
  voice: 'tts_voice_identifier',
  rate: 'tts_rate',
  provider: 'tts_provider',
  volcanoVoice: 'tts_volcano_voice',
} as const;

const DEFAULT_RATE = 0.95; // slightly slower than normal — easier for learners
const SLOW_RATE = 0.6;     // for hearing each syllable

// Generous bound passed to the preview player — actual playback stops at the
// end of the synthesized clip; this only guards against runaway audio.
const MAX_TTS_CLIP_SECONDS = 25;

export type TtsProvider = 'volcano' | 'system';

export interface TtsVoice {
  identifier: string;
  name: string;
  language: string;
  enhanced: boolean;
}

export interface TtsSettings {
  provider: TtsProvider;
  voice: string | null;     // system voice identifier
  volcanoVoice: string;     // volcano voice_type
  rate: number;
}

// In-memory cache so speak() stays synchronous for callers.
let _provider: TtsProvider = 'volcano';
let _voice: string | null = null;
let _volcanoVoice: string = DEFAULT_VOLCANO_VOICE;
let _rate: number = DEFAULT_RATE;
let _loaded = false;

async function ensureLoaded(): Promise<void> {
  if (_loaded) return;
  const [voice, rate, provider, volcanoVoice] = await Promise.all([
    Storage.getItem(KEYS.voice),
    Storage.getItem(KEYS.rate),
    Storage.getItem(KEYS.provider),
    Storage.getItem(KEYS.volcanoVoice),
  ]);
  _voice = voice || null;
  _rate = rate ? Number(rate) : DEFAULT_RATE;
  _provider = provider === 'system' ? 'system' : 'volcano';
  _volcanoVoice = volcanoVoice || DEFAULT_VOLCANO_VOICE;
  _loaded = true;
}
void ensureLoaded();

export async function getTtsSettings(): Promise<TtsSettings> {
  await ensureLoaded();
  return { provider: _provider, voice: _voice, volcanoVoice: _volcanoVoice, rate: _rate };
}

export async function setTtsProvider(provider: TtsProvider): Promise<void> {
  _provider = provider;
  await Storage.setItem(KEYS.provider, provider);
}

export async function setTtsVoice(identifier: string | null): Promise<void> {
  _voice = identifier;
  await Storage.setItem(KEYS.voice, identifier ?? '');
}

export async function setVolcanoVoice(voiceType: string): Promise<void> {
  _volcanoVoice = voiceType;
  await Storage.setItem(KEYS.volcanoVoice, voiceType);
}

export async function setTtsRate(rate: number): Promise<void> {
  _rate = rate;
  await Storage.setItem(KEYS.rate, String(rate));
}

/** All installed English voices, enhanced-quality first (system provider). */
export async function getEnglishVoices(): Promise<TtsVoice[]> {
  const voices = await Speech.getAvailableVoicesAsync();
  return voices
    .filter(v => v.language?.toLowerCase().startsWith('en'))
    .map(v => ({
      identifier: v.identifier,
      name: v.name || v.identifier,
      language: v.language,
      enhanced: v.quality === Speech.VoiceQuality.Enhanced,
    }))
    .sort((a, b) =>
      Number(b.enhanced) - Number(a.enhanced) || a.language.localeCompare(b.language)
    );
}

// ─── Speaking ─────────────────────────────────────────────────────────────────

function systemSpeak(text: string, rate: number, voice?: string | null): void {
  void Speech.stop();
  Speech.speak(text, {
    language: 'en-US',
    rate,
    ...(voice ? { voice } : {}),
  });
}

async function volcanoSpeak(text: string, rate: number): Promise<boolean> {
  const credentials = await getVolcanoCredentials();
  if (!credentials) return false; // not configured — quiet fallback, no error

  const file = await synthesizeToFile(text, credentials, {
    voiceType: _volcanoVoice,
    speedRatio: rate,
  });
  // The preview player gives us single-instance playback and play/pause
  // toggling when the same speak button is tapped again.
  togglePreview(`tts-${file.name}`, file.uri, 0, MAX_TTS_CLIP_SECONDS);
  return true;
}

async function speakAsync(text: string, slow: boolean): Promise<void> {
  await ensureLoaded(); // resolve the rate only after settings are in memory
  const rate = slow ? Math.min(SLOW_RATE, _rate) : _rate;
  if (_provider === 'volcano') {
    try {
      if (await volcanoSpeak(text, rate)) return;
    } catch (e) {
      log.warn('tts', `volcano TTS failed — falling back to system engine: ${e instanceof Error ? e.message : e}`);
    }
  }
  systemSpeak(text, rate, _voice);
}

/** Speaks English text aloud with the user's provider/voice/rate. Stops ongoing speech first. */
export function speak(text: string): void {
  void speakAsync(text, false);
}

/** Speaks at a slow rate — useful for hearing each syllable clearly. */
export function speakSlowly(text: string): void {
  void speakAsync(text, true);
}

const SAMPLE_TEXT = 'Learning English with Earmark is fun and effective.';

/** Preview a specific system voice/rate (used by the Settings voice picker). */
export function speakSample(voice: string | null, rate: number): void {
  void Speech.stop();
  systemSpeak(SAMPLE_TEXT, rate, voice);
}

/**
 * Preview a volcano voice (Settings picker). Throws when synthesis fails so
 * the Settings screen can explain (bad key, voice not enabled, offline).
 */
export async function speakVolcanoSample(voiceType: string, rate: number): Promise<void> {
  const credentials = await getVolcanoCredentials();
  if (!credentials) {
    throw new Error('请先在下方 API keys 中填入火山引擎 API Key 并保存。');
  }
  const file = await synthesizeToFile(SAMPLE_TEXT, credentials, { voiceType, speedRatio: rate });
  togglePreview(`tts-sample-${voiceType}`, file.uri, 0, MAX_TTS_CLIP_SECONDS);
}

export function stopSpeaking(): void {
  void Speech.stop();
  stopPreview();
}
