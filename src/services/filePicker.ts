import * as DocumentPicker from 'expo-document-picker';
import { File, Directory, Paths } from 'expo-file-system';
import { copyAsync } from 'expo-file-system/legacy';
import { log } from '../utils/logger';

// ─── Supported MIME types ─────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/ogg',
  'audio/flac',
  'audio/aac',
  'audio/webm',
  'audio/*',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PickedAudioFile {
  uri: string;
  name: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
}

export class FilePickerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilePickerError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractTitle(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[\\/:"*?<>|]+/g, '_').trim() || 'audio';
}

// ─── Pick & import ────────────────────────────────────────────────────────────

export async function pickAudioFile(): Promise<PickedAudioFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: SUPPORTED_MIME_TYPES,
    copyToCacheDirectory: false,
    multiple: false,
  });

  if (result.canceled) return null;

  const asset = result.assets[0];
  log.info('filePicker', `picked: ${asset.name}`, { uri: asset.uri, size: asset.size, mimeType: asset.mimeType });

  try {
    const audioDir = new Directory(Paths.document, 'audio');
    if (!audioDir.exists) audioDir.create({ intermediates: true });

    const destFileName = `${Date.now()}_${sanitizeFilename(asset.name)}`;
    const destFile = new File(audioDir, destFileName);
    log.debug('filePicker', `copying to: ${destFile.uri}`);

    await copyAsync({ from: asset.uri, to: destFile.uri });
    log.info('filePicker', `copy done, size: ${destFile.size}`);

    return {
      uri: destFile.uri,
      name: asset.name,
      title: extractTitle(asset.name),
      mimeType: asset.mimeType ?? 'audio/mpeg',
      sizeBytes: asset.size ?? destFile.size,
    };
  } catch (e) {
    log.error('filePicker', 'import failed', e instanceof Error ? e : new Error(String(e)));
    throw new FilePickerError(
      `Failed to import audio file: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// ─── File management ──────────────────────────────────────────────────────────

export async function deleteImportedAudio(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function getAudioFileSize(uri: string): number {
  return new File(uri).size;
}
