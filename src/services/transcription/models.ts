import {
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  deleteAsync,
  createDownloadResumable,
} from 'expo-file-system/legacy';
import type { WhisperModelName } from '../settings';
import { getModelMirrorBase } from '../settings';
import { log } from '../../utils/logger';

// ─── Whisper model registry ───────────────────────────────────────────────────
// Quantized (q5_1) ggml models from the official whisper.cpp repo on Hugging Face.
// q5_1 cuts download size roughly in half with negligible accuracy loss on phones.
// The download URL is built from the active mirror at download time (see
// getModelMirrorBase) so mainland-China users can fetch via hf-mirror.com.

export interface WhisperModelInfo {
  name: WhisperModelName;
  label: string;
  description: string;
  fileName: string;
  sizeMB: number; // approximate download size, for UI display
}

export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    name: 'tiny.en',
    label: 'Tiny (English)',
    description: 'Fastest, lowest accuracy. Good for older phones.',
    fileName: 'ggml-tiny.en-q5_1.bin',
    sizeMB: 32,
  },
  {
    name: 'base.en',
    label: 'Base (English) — recommended',
    description: 'Good balance of speed and accuracy for podcasts.',
    fileName: 'ggml-base.en-q5_1.bin',
    sizeMB: 60,
  },
  {
    name: 'small.en',
    label: 'Small (English)',
    description: 'Best accuracy, slower. Needs a recent phone.',
    fileName: 'ggml-small.en-q5_1.bin',
    sizeMB: 190,
  },
];

export function getModelInfo(name: WhisperModelName): WhisperModelInfo {
  const info = WHISPER_MODELS.find(m => m.name === name);
  if (!info) throw new Error(`Unknown whisper model: ${name}`);
  return info;
}

// ─── Storage paths ────────────────────────────────────────────────────────────

const MODELS_DIR = `${documentDirectory}whisper-models/`;

export function getModelPath(name: WhisperModelName): string {
  return `${MODELS_DIR}${getModelInfo(name).fileName}`;
}

export async function isModelDownloaded(name: WhisperModelName): Promise<boolean> {
  const info = await getInfoAsync(getModelPath(name));
  return info.exists && (info.size ?? 0) > 0;
}

export async function getDownloadedModels(): Promise<WhisperModelName[]> {
  const checks = await Promise.all(
    WHISPER_MODELS.map(async m => ((await isModelDownloaded(m.name)) ? m.name : null))
  );
  return checks.filter((m): m is WhisperModelName => m !== null);
}

// ─── Download / delete ────────────────────────────────────────────────────────

/**
 * Downloads a whisper model (one-time, requires internet).
 * After this, transcription works fully offline.
 */
export async function downloadModel(
  name: WhisperModelName,
  onProgress?: (fraction: number) => void
): Promise<string> {
  const dirInfo = await getInfoAsync(MODELS_DIR);
  if (!dirInfo.exists) await makeDirectoryAsync(MODELS_DIR, { intermediates: true });

  const info = getModelInfo(name);
  const dest = getModelPath(name);
  const url = `${await getModelMirrorBase()}/${info.fileName}`;
  log.info('models', `downloading ${info.fileName} (${info.sizeMB} MB) from ${url}`);

  const download = createDownloadResumable(url, dest, {}, progress => {
    if (progress.totalBytesExpectedToWrite > 0) {
      onProgress?.(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
    }
  });

  try {
    const result = await download.downloadAsync();
    if (!result || (result.status !== 200 && result.status !== 206)) {
      throw new Error(`Download failed (HTTP ${result?.status ?? 'unknown'})`);
    }
    log.info('models', `downloaded ${info.fileName}`);
    return dest;
  } catch (e) {
    // Don't leave a partial file behind — it would pass the "downloaded" check.
    try { await deleteAsync(dest, { idempotent: true }); } catch {}
    throw e;
  }
}

export async function deleteModel(name: WhisperModelName): Promise<void> {
  await deleteAsync(getModelPath(name), { idempotent: true });
}
