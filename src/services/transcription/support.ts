import Constants from 'expo-constants';

// Detects whether the native modules for on-device transcription are present.
//
// Two layers of defense:
//  1. In Expo Go we must not even require() these packages — when their
//     native side is missing they report a fatal "Failed to install ..."
//     error to LogBox that escapes try/catch. `executionEnvironment ===
//     'storeClient'` means Expo Go, where the native modules can never exist.
//  2. In dev/prod builds, verify the actual APIs are functions rather than
//     trusting require() success.
export function isLocalEngineSupported(): boolean {
  if (Constants.executionEnvironment === 'storeClient') return false; // Expo Go

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const whisper = require('whisper.rn');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const audioApi = require('react-native-audio-api');
    return (
      typeof whisper?.initWhisper === 'function' &&
      typeof audioApi?.AudioContext === 'function'
    );
  } catch {
    return false;
  }
}
