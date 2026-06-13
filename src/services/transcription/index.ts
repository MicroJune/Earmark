import { replaceTranscript } from '../../db/queries/transcript';
import { updateAudioFileStatus } from '../../db/queries/audioFiles';
import { useAudioFilesStore } from '../../store/audioFilesStore';
import { getSettings } from '../settings';
import { getApiKeys } from '../config';
import { transcribeAudioVolcano } from './volcanoAsr';
import { transcribeAudioLocally } from './localWhisper';
import { log } from '../../utils/logger';
import { isLocalEngineSupported } from './support';

export { isLocalEngineSupported } from './support';

// ─── Transcription orchestrator ───────────────────────────────────────────────
// Dispatches to the engine chosen in Settings:
//   - 'local': whisper.cpp on-device (offline, no API key, no file size limit)
//   - 'cloud': 火山引擎豆包 ASR (needs internet + credentials, 100 MB limit)

export interface TranscribeOptions {
  language?: string;
  fileSizeBytes?: number;
}

/**
 * Full transcription pipeline:
 *   1. Marks the file as 'transcribing'
 *   2. Runs the configured engine (local whisper.cpp or Volcano cloud)
 *   3. Saves segments and words to SQLite
 *   4. Marks the file as 'ready'
 *
 * On any failure, marks the file as 'error' and re-throws so the caller
 * can surface it to the user.
 */
export async function transcribeAndSave(
  audioFileId: number,
  uri: string,
  options: TranscribeOptions = {}
): Promise<void> {
  const { refreshAudioFile, setTranscriptionProgress } = useAudioFilesStore.getState();

  // A backup-restored placeholder has no audio binary (empty uri). Don't try to
  // decode nothing — guide the user to re-import the audio (which re-links to
  // this row and its restored transcript). Belt-and-suspenders: callers also
  // route empty-uri files to re-import rather than here.
  if (!uri) {
    await updateAudioFileStatus(
      audioFileId,
      'error',
      'Audio file is missing — re-import it (same name) to enable playback.'
    );
    await refreshAudioFile(audioFileId);
    return;
  }

  const settings = await getSettings();

  // The saved setting may say 'local' from a build where the native engine
  // existed (or vice versa). If it isn't available here — e.g. Expo Go —
  // fall back to cloud rather than failing.
  let engine = settings.transcriptionEngine;
  let fellBack = false;
  if (engine === 'local' && !isLocalEngineSupported()) {
    engine = 'cloud';
    fellBack = true;
    log.warn('transcription', 'on-device engine not available in this build — falling back to cloud');
  }

  log.info('transcription', `start id=${audioFileId} engine=${engine}`, { uri });
  await updateAudioFileStatus(audioFileId, 'transcribing');
  await refreshAudioFile(audioFileId);

  try {
    let parsed;
    if (engine === 'local') {
      parsed = await transcribeAudioLocally(uri, settings.whisperModel, {
        language: options.language,
        onProgress: fraction => setTranscriptionProgress(audioFileId, fraction),
      });
    } else {
      const keys = await getApiKeys();
      if (!keys.volcApiKey) {
        throw new Error(
          fellBack
            ? 'On-device transcription needs the development build (Expo Go can\'t run it), and cloud transcription needs a 火山引擎 API Key. Add it in Settings to transcribe in Expo Go.'
            : 'Cloud transcription needs a 火山引擎 API Key. Add it in Settings, or switch to the On-device engine.'
        );
      }
      parsed = await transcribeAudioVolcano(
        uri,
        { apiKey: keys.volcApiKey },
        options
      );
    }

    log.info('transcription', `done: ${parsed.segments.length} segments, ${parsed.words.length} words`);
    await replaceTranscript(audioFileId, parsed);

    await updateAudioFileStatus(audioFileId, 'ready');
    await refreshAudioFile(audioFileId);
  } catch (e) {
    log.error('transcription', `failed id=${audioFileId}`, e instanceof Error ? e : new Error(String(e)));
    const message = e instanceof Error ? e.message : 'Unknown transcription error';
    await updateAudioFileStatus(audioFileId, 'error', message);
    await refreshAudioFile(audioFileId);
    throw e;
  } finally {
    setTranscriptionProgress(audioFileId, null);
  }
}
