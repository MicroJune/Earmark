import * as Speech from 'expo-speech';

// Text-to-speech via the device's built-in TTS engine (works fully offline).
// Used to read saved words / phrases / sentences aloud for pronunciation.

/** Speaks English text aloud. Any ongoing speech is stopped first. */
export function speak(text: string): void {
  Speech.stop();
  Speech.speak(text, {
    language: 'en-US',
    rate: 0.95, // slightly slower than default — easier for learners
  });
}

/** Speaks at a slow rate — useful for hearing each syllable clearly. */
export function speakSlowly(text: string): void {
  Speech.stop();
  Speech.speak(text, {
    language: 'en-US',
    rate: 0.6,
  });
}

export function stopSpeaking(): void {
  Speech.stop();
}
