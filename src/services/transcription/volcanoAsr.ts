import type { ParsedTranscript, ParsedSegment, ParsedWord } from '../../utils/transcriptBuilder';
import { makeRequestId, type VolcanoCredentials } from '../volcano';
import { log } from '../../utils/logger';

// ─── Cloud transcription: 火山引擎 大模型录音文件极速版识别 ────────────────────
// Flash AUC flow: upload the audio bytes directly and receive the result in one
// request. This works for local file:// / content:// audio files because we read
// the local file into a Blob before calling Volcano.

const FLASH_RECOGNIZE_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
const RESOURCE_ID = 'volc.bigasr.auc_turbo';

// API limit: 100 MB / 2 hours per file.
// Official docs recommend keeping direct audio payloads around 20 MB when
// possible because upload speed depends on the client's network.
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const STATUS_OK = '20000000';

// Flash supports WAV / MP3 / OGG OPUS.
const KNOWN_FORMATS = new Set(['wav', 'mp3', 'ogg']);

export class TranscriptionError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number | string,
    public readonly isFileTooLarge = false
  ) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

export interface TranscriptionOptions {
  language?: string;        // accepted for interface parity; the bigmodel auto-detects
  fileSizeBytes?: number;   // if provided, validated against the 100 MB limit
}

// ─── Response shape (times in milliseconds) ──────────────────────────────────

interface AucWord { text: string; start_time: number; end_time: number }
interface AucUtterance {
  text: string;
  start_time: number;
  end_time: number;
  words?: AucWord[];
}
interface AucResult {
  code?: number | string;
  message?: string;
  status_code?: number | string;
  status_text?: string;
  text?: string;
  utterances?: AucUtterance[];
  result?: { text?: string; utterances?: AucUtterance[] };
}

function buildTranscript(utterances: AucUtterance[]): ParsedTranscript {
  const segments: ParsedSegment[] = [];
  const words: ParsedWord[] = [];

  for (const u of utterances) {
    const text = u.text?.trim();
    if (!text) continue;

    const segmentIndex = segments.length;
    const wordStartIndex = words.length;

    for (const w of u.words ?? []) {
      const word = w.text?.trim();
      if (!word) continue;
      words.push({
        wordIndex: words.length,
        segmentIndex,
        word,
        start: w.start_time / 1000,
        end: w.end_time / 1000,
      });
    }

    segments.push({
      segmentIndex,
      text,
      start: u.start_time / 1000,
      end: u.end_time / 1000,
      wordStartIndex,
      wordEndIndex: Math.max(wordStartIndex, words.length - 1),
    });
  }

  return { segments, words };
}

function getFileName(uri: string): string {
  const cleanUri = uri.split('?')[0].split('#')[0];
  const fileName = cleanUri.split('/').pop() ?? 'audio.mp3';
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function getFormat(uri: string): string {
  const cleanUri = uri.split('?')[0].split('#')[0];
  const ext = cleanUri.split('.').pop()?.toLowerCase() ?? '';
  if (KNOWN_FORMATS.has(ext)) return ext;

  throw new TranscriptionError(
    `Unsupported audio format "${ext || 'unknown'}". Volcano AUC Flash supports WAV, MP3, and OGG OPUS.`
  );
}

async function readJson(response: Response): Promise<AucResult | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as AucResult;
  } catch {
    return { message: text };
  }
}

function getResult(json: AucResult | null): { text?: string; utterances?: AucUtterance[] } {
  return {
    text: json?.result?.text ?? json?.text,
    utterances: json?.result?.utterances ?? json?.utterances,
  };
}

function getJsonStatus(json: AucResult | null): string | undefined {
  const status = json?.status_code ?? json?.code;
  return status === undefined ? undefined : String(status);
}

function getJsonMessage(json: AucResult | null): string | undefined {
  return json?.status_text ?? json?.message;
}

function getResponseStatus(response: Response, json: AucResult | null): string | null {
  return response.headers.get('X-Api-Status-Code') ?? getJsonStatus(json) ?? null;
}

function makeHeaders(
  credentials: VolcanoCredentials,
  requestId: string
): Record<string, string> {
  return {
    'X-Api-Key': credentials.apiKey,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
    'Content-Type': 'application/json',
  };
}

function makeApiError(
  response: Response,
  statusCode: string | null,
  json: AucResult | null
): TranscriptionError {
  const code = statusCode ?? getJsonStatus(json) ?? response.status;
  const message = response.headers.get('X-Api-Message') ?? getJsonMessage(json) ?? `HTTP ${response.status}`;

  if (response.status === 401 || response.status === 403 || code === '45000151') {
    return new TranscriptionError(
      '火山引擎凭证被拒绝。请检查 Settings 里的 API Key,并确认已开通「大模型录音文件极速版识别」服务和 volc.bigasr.auc_turbo 权限。',
      code
    );
  }

  return new TranscriptionError(
    `Volcano flash recognize failed: ${message} (${code})`,
    code
  );
}

async function readAudioBytes(uri: string): Promise<Uint8Array> {
  // React Native / Expo can usually fetch file:// and content:// URIs and expose
  // them as an ArrayBuffer. The URI is only used locally; Volcano receives the
  // base64-encoded file content in audio.data.
  const response = await fetch(uri);

  if (!response.ok) {
    throw new TranscriptionError(
      `Unable to read local audio file: HTTP ${response.status}. URI: ${uri}`
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    output +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63] +
      alphabet[n & 63];
  }

  if (i < bytes.length) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const n = (a << 16) | (b << 8);
    output += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=';
    output += '=';
  }

  return output;
}

async function recognizeFlash(
  uri: string,
  credentials: VolcanoCredentials,
  requestId: string
): Promise<AucResult> {
  const format = getFormat(uri);
  const audioBytes = await readAudioBytes(uri);
  const audioBase64 = bytesToBase64(audioBytes);

  const response = await fetch(FLASH_RECOGNIZE_URL, {
    method: 'POST',
    headers: makeHeaders(credentials, requestId),
    body: JSON.stringify({
      user: {
        uid: 'postcast-assistant',
      },
      audio: {
        data: audioBase64,
        format,
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: false,
        enable_ddc: false,
        enable_speaker_info: false,
        enable_channel_split: false,
        show_utterances: true,
        vad_segment: false,
        sensitive_words_filter: '',
      },
    }),
  });

  const json = await readJson(response);
  const code = getResponseStatus(response, json);
  const { text, utterances } = getResult(json);

  if (response.ok && (code === STATUS_OK || code === null) && (text || utterances?.length)) {
    return json ?? {};
  }

  log.error('volcano-asr', `flash recognize failed: HTTP ${response.status}, status=${code} ${response.headers.get('X-Api-Message') ?? getJsonMessage(json) ?? ''}`);
  throw makeApiError(response, code, json);
}

// ─── Core API call ────────────────────────────────────────────────────────────

/**
 * Uploads local audio bytes to the Volcano AUC Flash API and returns a
 * ParsedTranscript. Pure function — does not touch the database.
 */
export async function transcribeAudioVolcano(
  uri: string,
  credentials: VolcanoCredentials,
  options: TranscriptionOptions = {}
): Promise<ParsedTranscript> {
  const { fileSizeBytes } = options;

  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new TranscriptionError(
      `File is too large (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB). ` +
      'Volcano AUC Flash supports files up to 100 MB — use the on-device engine or standard URL-based AUC for bigger files.',
      undefined,
      true
    );
  }

  const requestId = makeRequestId();
  const fileName = getFileName(uri);

  log.debug('volcano-asr', `recognizing AUC flash audio: ${fileName} request=${requestId}`);
  const json = await recognizeFlash(uri, credentials, requestId);
  const { text, utterances = [] } = getResult(json);

  if (utterances.length === 0) {
    throw new TranscriptionError(
      text
        ? 'Volcano returned a transcript without timestamps — cannot build word sync.'
        : 'Volcano returned an empty transcript. Is the audio silent or in an unsupported format?'
    );
  }

  const parsed = buildTranscript(utterances);
  if (parsed.words.length === 0) {
    throw new TranscriptionError('Volcano returned no word-level timestamps — cannot build word sync.');
  }
  return parsed;
}
