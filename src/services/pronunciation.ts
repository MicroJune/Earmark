import { File, Directory, Paths } from 'expo-file-system';
import type { SavedItem } from '../types';
import { lookupWord } from './dictionary';
import { speak } from './tts';
import { togglePreview } from './audio';

// Standard word pronunciations live here after the pronunciation pack is
// installed/downloaded. Expected layout:
// document/pronunciation/en-us/a/abandon.opus
const PACK_ROOT = new Directory(Paths.document, 'pronunciation', 'en-us');
const AUDIO_EXTENSIONS = ['opus', 'mp3', 'm4a'] as const;
const MAX_WORD_AUDIO_SECONDS = 8;

export interface PronunciationAudio {
  key: string;
  uri: string;
  source: 'pack';
}

function wordAudioKey(text: string): string | null {
  const entry = lookupWord(text);
  if (!entry) return null;
  return entry.word.toLowerCase();
}

function fileForKey(key: string, extension: typeof AUDIO_EXTENSIONS[number]): File {
  return new File(new Directory(PACK_ROOT, key[0]), `${key}.${extension}`);
}

export function getPronunciationAudio(text: string): PronunciationAudio | null {
  const key = wordAudioKey(text);
  if (!key) return null;

  for (const extension of AUDIO_EXTENSIONS) {
    const file = fileForKey(key, extension);
    if (file.exists) {
      return { key, uri: file.uri, source: 'pack' };
    }
  }
  return null;
}

export function hasPronunciationAudio(text: string): boolean {
  return getPronunciationAudio(text) !== null;
}

export function playPronunciationText(previewKey: string, text: string): void {
  const audio = getPronunciationAudio(text);
  if (audio) {
    togglePreview(previewKey, audio.uri, 0, MAX_WORD_AUDIO_SECONDS);
    return;
  }
  speak(text);
}

export function playSavedItemPronunciation(previewKey: string, item: Pick<SavedItem, 'text' | 'type'>): void {
  if (item.type === 'word') {
    playPronunciationText(previewKey, item.text);
    return;
  }
  speak(item.text);
}
