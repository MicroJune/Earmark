import { File, Directory, Paths } from 'expo-file-system';
import { log } from '../../utils/logger';

// ─── Audio decoding for on-device Whisper ─────────────────────────────────────
// whisper.cpp only accepts 16 kHz mono 16-bit WAV. Podcasts are mp3/m4a, so we
// decode with the platform decoder (via react-native-audio-api) and re-encode
// a temporary WAV file next to the cache.
//
// react-native-audio-api is a native module: it works in a dev build but not in
// Expo Go, so it is require()d lazily and only when the local engine is used.

export const WHISPER_SAMPLE_RATE = 16000;

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

function loadAudioApi(): any {
  let mod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('react-native-audio-api');
  } catch {
    // fall through to the check below
  }
  // In Expo Go the JS module may load but its native bindings are absent,
  // leaving exports undefined — verify the API actually exists.
  if (typeof mod?.AudioContext !== 'function') {
    throw new AudioDecodeError(
      'On-device transcription is not available in Expo Go — it needs the development build of this app ' +
      '(see OFFLINE_SETUP.md). Until then, switch to the Cloud engine in Settings.'
    );
  }
  return mod;
}

// ─── PCM helpers ──────────────────────────────────────────────────────────────

function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) sum += channels[c][i];
    mono[i] = sum / channels.length;
  }
  return mono;
}

/** Linear resampler — fallback in case the decoder ignores the requested rate. */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const outLength = Math.floor((input.length * toRate) / fromRate);
  const out = new Float32Array(outLength);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
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
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Decodes any supported audio file (mp3, m4a, wav, …) to a temporary
 * 16 kHz mono WAV file and returns its uri. Caller must delete it afterwards
 * via deleteTempWav().
 */
export async function decodeToWhisperWav(uri: string): Promise<string> {
  const { AudioContext } = loadAudioApi();

  log.info('audioDecoder', `decoding ${uri}`);
  const ctx = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const audioBuffer = await ctx.decodeAudioDataSource(uri);
    if (!audioBuffer) throw new AudioDecodeError('Could not decode audio file');

    const channels: Float32Array[] = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }
    let mono = mixToMono(channels);
    if (audioBuffer.sampleRate !== WHISPER_SAMPLE_RATE) {
      mono = resampleLinear(mono, audioBuffer.sampleRate, WHISPER_SAMPLE_RATE);
    }

    const wavBytes = encodeWav16BitMono(mono, WHISPER_SAMPLE_RATE);

    const tmpDir = new Directory(Paths.cache, 'whisper-tmp');
    if (!tmpDir.exists) tmpDir.create({ intermediates: true });
    const wavFile = new File(tmpDir, `decode_${Date.now()}.wav`);
    wavFile.write(wavBytes);

    log.info('audioDecoder', `decoded ${(wavBytes.length / 1024 / 1024).toFixed(1)} MB wav`);
    return wavFile.uri;
  } finally {
    try { await ctx.close(); } catch {}
  }
}

export function deleteTempWav(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {}
}
