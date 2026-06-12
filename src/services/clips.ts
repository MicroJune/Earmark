import { File, Directory, Paths } from 'expo-file-system';
import { log } from '../utils/logger';
import { isLocalEngineSupported } from './transcription/support';

// ─── Audio clip extraction ────────────────────────────────────────────────────
// When a podcast file is deleted, the saved phrases would lose their original
// audio. Before deletion we decode the file ONCE and slice out a small WAV
// clip per saved item, stored permanently under document/clips. Review and
// item-detail playback prefer these clips, so learning cards fully outlive
// their source file.
//
// Decoding uses react-native-audio-api (native module) — available in the dev
// build only, so it is require()d lazily. In Expo Go extraction is skipped.

// Padding around the phrase so playback doesn't cut mid-word (matches the
// padding used when playing from the original file).
const PRE_PAD_SECONDS = 0.3;
const POST_PAD_SECONDS = 0.4;

export interface ClipRequest {
  id: number;       // saved item id — used for the clip filename
  startTime: number; // seconds in the source file
  endTime: number;   // seconds
}

export function isClipExtractionSupported(): boolean {
  return isLocalEngineSupported();
}

function getClipsDir(): Directory {
  const dir = new Directory(Paths.document, 'clips');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function encodeWav16BitMono(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

/**
 * Decodes the source file once and writes a WAV clip per request.
 * Returns a map of saved-item id → clip file uri (entries are omitted for
 * clips that failed individually). Throws if the file can't be decoded at all
 * or extraction is unsupported (Expo Go).
 */
export async function extractClips(
  sourceUri: string,
  requests: ClipRequest[]
): Promise<Map<number, string>> {
  if (requests.length === 0) return new Map();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod: any = (() => { try { return require('react-native-audio-api'); } catch { return null; } })();
  if (typeof mod?.AudioContext !== 'function') {
    throw new Error('Clip extraction needs the development build (not available in Expo Go).');
  }

  log.info('clips', `extracting ${requests.length} clip(s) from ${sourceUri}`);
  const ctx = new mod.AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioDataSource(sourceUri);
    if (!audioBuffer) throw new Error('Could not decode source audio');

    const sampleRate: number = audioBuffer.sampleRate;
    const channelCount: number = audioBuffer.numberOfChannels;
    const channels: Float32Array[] = [];
    for (let c = 0; c < channelCount; c++) channels.push(audioBuffer.getChannelData(c));
    const totalSamples = channels[0].length;

    const dir = getClipsDir();
    const result = new Map<number, string>();

    for (const req of requests) {
      try {
        const from = Math.max(0, Math.floor((req.startTime - PRE_PAD_SECONDS) * sampleRate));
        const to = Math.min(totalSamples, Math.ceil((req.endTime + POST_PAD_SECONDS) * sampleRate));
        if (to <= from) continue;

        // Mix the slice to mono
        const mono = new Float32Array(to - from);
        for (let i = from; i < to; i++) {
          let sum = 0;
          for (let c = 0; c < channelCount; c++) sum += channels[c][i];
          mono[i - from] = sum / channelCount;
        }

        const clipFile = new File(dir, `clip_${req.id}.wav`);
        clipFile.write(encodeWav16BitMono(mono, sampleRate));
        result.set(req.id, clipFile.uri);
      } catch (e) {
        log.warn('clips', `clip ${req.id} failed`, e instanceof Error ? e.message : String(e));
      }
    }

    log.info('clips', `extracted ${result.size}/${requests.length} clip(s)`);
    return result;
  } finally {
    try { await ctx.close(); } catch {}
  }
}

export function deleteClipFile(clipUri: string): void {
  try {
    const f = new File(clipUri);
    if (f.exists) f.delete();
  } catch {}
}

/** Total bytes used by extracted clips (for the storage screen). */
export function getClipsStorageBytes(): number {
  try {
    const dir = new Directory(Paths.document, 'clips');
    if (!dir.exists) return 0;
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}
