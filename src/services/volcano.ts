import { File, Directory, Paths } from 'expo-file-system';
import { getApiKeys } from './config';
import { log } from '../utils/logger';

// ─── Volcano Engine (火山引擎 豆包语音) client ─────────────────────────────────
// One API Key covers both speech services this app uses:
//   - TTS: 语音合成 (bigtts voices) — dictionary-quality pronunciation readout
//   - ASR: 大模型录音文件识别极速版 — cloud transcription (see transcription/volcanoAsr.ts)
// Synthesized audio is cached on disk forever, so each text costs one network
// call ever — after that, playback works offline. Keys live in SecureStore only.

const TTS_URL = 'https://openspeech.bytedance.com/api/v1/tts';
const TTS_CACHE_DIR_NAME = 'tts-cache';

// Success code of the /api/v1/tts endpoint (not 200/0!).
const TTS_OK_CODE = 3000;

export class VolcanoError extends Error {
  constructor(message: string, public readonly code?: number | string) {
    super(message);
    this.name = 'VolcanoError';
  }
}

export interface VolcanoCredentials {
  apiKey: string;
}

/** Credentials from SecureStore, or null when not configured. */
export async function getVolcanoCredentials(): Promise<VolcanoCredentials | null> {
  const keys = await getApiKeys();
  if (!keys.volcApiKey) return null;
  return { apiKey: keys.volcApiKey };
}

export function makeRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── English voices (语音合成大模型 bigtts) ────────────────────────────────────
// Available after enabling 豆包·语音合成大模型 in the Volcano console. Curated
// from the official voice list (www.volcengine.com/docs/6561/1257544).

export interface VolcanoVoice {
  id: string;
  label: string;  // shown in Settings
}

export const VOLCANO_VOICES: VolcanoVoice[] = [
  { id: 'en_male_adam_mars_bigtts',    label: 'Adam · 美音男' },
  { id: 'en_female_amanda_mars_bigtts', label: 'Amanda · 美音女' },
  { id: 'en_male_jackson_mars_bigtts', label: 'Jackson · 美音男' },
  { id: 'en_female_anna_mars_bigtts',  label: 'Anna · 英音女' },
  { id: 'en_male_smith_mars_bigtts',   label: 'Smith · 英音男' },
  { id: 'en_female_emily_mars_bigtts', label: 'Emily · 英音女' },
  { id: 'en_female_sarah_mars_bigtts', label: 'Sarah · 澳音女' },
  { id: 'en_male_dryw_mars_bigtts',    label: 'Dryw · 澳音男' },
];

export const DEFAULT_VOLCANO_VOICE = VOLCANO_VOICES[0].id;

// ─── Synthesis with disk cache ────────────────────────────────────────────────

export interface SynthesisOptions {
  voiceType: string;
  speedRatio: number; // 1.0 = normal; volcano accepts 0.2–3.0
}

// FNV-1a 32-bit — good enough to key a personal cache; text length is mixed in
// to make accidental collisions even less likely.
function cacheKey(text: string, opts: SynthesisOptions): string {
  const input = `${opts.voiceType}|${opts.speedRatio}|${text}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16)}-${input.length}`;
}

function cacheFile(key: string): File {
  return new File(new Directory(Paths.document, TTS_CACHE_DIR_NAME), `${key}.mp3`);
}

/**
 * Returns a local mp3 for the given text — from the disk cache when available,
 * otherwise synthesized via the Volcano TTS API and cached. Throws VolcanoError
 * when offline, the credentials are wrong, or the voice isn't enabled.
 */
export async function synthesizeToFile(
  text: string,
  credentials: VolcanoCredentials,
  options: SynthesisOptions
): Promise<File> {
  const file = cacheFile(cacheKey(text, options));
  if (file.exists) return file;

  log.debug('volcano-tts', `synthesizing ${text.length} chars, voice=${options.voiceType}`);
  const response = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'x-api-key': credentials.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      app: { cluster: 'volcano_tts' },
      user: { uid: 'earmark' },
      audio: {
        voice_type: options.voiceType,
        encoding: 'mp3',
        speed_ratio: options.speedRatio,
      },
      request: { reqid: makeRequestId(), text, operation: 'query' },
    }),
  });

  if (!response.ok) {
    throw new VolcanoError(`豆包语音合成请求失败 (HTTP ${response.status})`, response.status);
  }

  const json = await response.json();
  if (json.code !== TTS_OK_CODE || !json.data) {
    throw new VolcanoError(
      `豆包语音合成失败: ${json.message ?? 'unknown error'} (code ${json.code})。` +
      '请检查火山引擎 API Key 是否正确、是否已开通语音合成并启用所选音色。',
      json.code
    );
  }

  const dir = new Directory(Paths.document, TTS_CACHE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  file.write(json.data, { encoding: 'base64' });
  log.info('volcano-tts', `cached ${file.uri.split('/').pop()} (${Math.round((json.data.length * 3) / 4 / 1024)} KB)`);
  return file;
}

/** Deletes all cached synthesized audio. Returns the number of files removed. */
export function clearTtsCache(): number {
  const dir = new Directory(Paths.document, TTS_CACHE_DIR_NAME);
  if (!dir.exists) return 0;
  const entries = dir.list();
  dir.delete();
  return entries.length;
}
