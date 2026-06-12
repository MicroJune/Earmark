import { buildParsedTranscript } from '../utils/transcriptBuilder';
import { log } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3';

// Groq Whisper file size limit (25 MB)
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// ─── Supported audio MIME types ───────────────────────────────────────────────

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3:  'audio/mpeg',
  mp4:  'audio/mp4',
  m4a:  'audio/mp4',
  wav:  'audio/wav',
  webm: 'audio/webm',
  ogg:  'audio/ogg',
  flac: 'audio/flac',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  aac:  'audio/aac',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMimeType(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_MIME_TYPES[ext] ?? 'audio/mpeg';
}

function getFileName(uri: string): string {
  return uri.split('/').pop() ?? 'audio.mp3';
}

function getGroqErrorMessage(status: number, responseText: string): string {
  let parsed: any = null;
  try { parsed = JSON.parse(responseText); } catch {}

  const apiMessage = parsed?.error?.message;
  if (status === 401 || status === 403) {
    return apiMessage && apiMessage !== 'Forbidden'
      ? `Groq API key was rejected: ${apiMessage}`
      : 'Groq API key was rejected. Check that the key is valid, active, and has access to audio transcriptions.';
  }

  return apiMessage ?? `Groq API error (HTTP ${status})`;
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isFileTooLarge = false
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

// ─── Transcription options ────────────────────────────────────────────────────

export interface TranscriptionOptions {
  language?: string;        // ISO 639-1 code, e.g. 'en'. Omit for auto-detect.
  fileSizeBytes?: number;   // If provided, validated against Groq's 25 MB limit.
}

// ─── Core API call ────────────────────────────────────────────────────────────

/**
 * Sends an audio file to the Groq Whisper API and returns a ParsedTranscript.
 * Pure function — does not touch the database.
 */
export async function transcribeAudio(
  uri: string,
  groqApiKey: string,
  options: TranscriptionOptions = {}
) {
  const { language, fileSizeBytes } = options;

  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new TranscriptionError(
      `File is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB). Groq Whisper supports files up to 25 MB.`,
      undefined,
      true
    );
  }

  // new-arch fetch (NativeRequest) rejects {uri,name,type} FormData parts and
  // doesn't support data: URLs. XMLHttpRequest uses NativeNetworkingAndroid
  // which still handles the {uri} blob pattern natively.
  const mimeType = getMimeType(uri);
  const fileName = getFileName(uri);
  log.debug('whisper', `uploading via XHR: ${fileName} (${mimeType})`);

  const formData = new FormData();
  formData.append('file', { uri, name: fileName, type: mimeType } as any);
  formData.append('model', WHISPER_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');
  if (language) formData.append('language', language);

  const data = await new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', GROQ_TRANSCRIPTION_URL);
    xhr.setRequestHeader('Authorization', `Bearer ${groqApiKey}`);
    xhr.onload = () => {
      log.debug('whisper', `XHR status ${xhr.status}`);
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new TranscriptionError('Invalid JSON in Groq response')); }
      } else {
        const message = getGroqErrorMessage(xhr.status, xhr.responseText);
        log.error('whisper', `Groq XHR ${xhr.status}`, xhr.responseText);
        reject(new TranscriptionError(message, xhr.status));
      }
    };
    xhr.onerror = () => {
      log.error('whisper', 'XHR network error');
      reject(new TranscriptionError('Network request failed'));
    };
    xhr.send(formData);
  });

  return buildParsedTranscript(data);
}
