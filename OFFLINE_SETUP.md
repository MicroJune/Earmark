# Offline (On-device) Transcription Setup

The app now supports two transcription engines (Settings → Transcription):

| Engine | Internet | API key | File size limit | Speed |
|---|---|---|---|---|
| **On-device** (whisper.cpp) | Only for the one-time model download | None | None | ~real-time with `base.en` on a modern phone |
| **Cloud** (火山引擎 豆包 ASR) | Required | Required (API Key) | 100 MB | Very fast |

On-device transcription uses two **native** modules:

- [`whisper.rn`](https://github.com/mybigday/whisper.rn) — whisper.cpp running on the phone
- [`react-native-audio-api`](https://github.com/software-mansion/react-native-audio-api) — decodes mp3/m4a to the 16 kHz WAV whisper.cpp needs

Native modules **do not work in Expo Go**. You need a one-time *development build*.
The app detects this: in Expo Go the on-device engine shows a friendly error and
you can keep using the Cloud engine.

## One-time: build the dev client (Android)

Run inside WSL from the project root:

```bash
# 1. Generate the native android/ project (config plugins are applied automatically)
npx expo prebuild --platform android

# 2. Build and install on a connected phone / emulator
#    Requires Android Studio + SDK; or use EAS Build (step 2b) instead.
npx expo run:android
```

No Android SDK locally? Use EAS Build (free tier, builds in the cloud):

```bash
# 2b. Cloud build — produces an installable APK
npx eas build --profile development --platform android
```

After installing the dev build once, daily development is the same as before:
`npx expo start` and open the project from the **dev build** app (not Expo Go).

> whisper.rn note: Android requires `ndkVersion "24.0.8215888"` or newer. If the
> build complains, set `ndkVersion` in `android/build.gradle`.

## Using it

1. Open **Settings** (gear icon on Home) → select **On-device (offline)**.
2. Download a model (one-time, over Wi-Fi):
   - `Tiny (en)` ~32 MB — fastest, older phones
   - `Base (en)` ~60 MB — **recommended** for podcasts
   - `Small (en)` ~190 MB — best accuracy, recent phones
3. Import a podcast as usual. Progress (%) is shown on the file card. Everything
   — transcription, word-sync, saving phrases, review — now works in airplane mode.

## What still needs internet

- **AI phrase suggestions & learning notes** (optional — 豆包/火山方舟 or DeepSeek key).
  Results are cached per file/item, so once fetched they are available offline.
- Whisper **model download** (one-time per model).
- **豆包朗读 (TTS)** — first playback of each text only; the audio is then cached
  on disk and replays offline. Falls back to the system TTS engine when offline.

## How it works

```
audio file (mp3/m4a/wav…)
   → react-native-audio-api decodes + resamples to 16 kHz mono PCM
   → temporary WAV in cache
   → whisper.rn (whisper.cpp) with tokenTimestamps + maxLen=1  → word-level timestamps
   → words grouped into sentences by punctuation
   → same SQLite schema as the cloud engine (segments + words)
```

Code map:

- `src/services/transcription/index.ts` — engine dispatch + DB pipeline
- `src/services/transcription/localWhisper.ts` — whisper.rn integration
- `src/services/transcription/audioDecoder.ts` — mp3/m4a → 16 kHz WAV
- `src/services/transcription/models.ts` — model registry + downloads
- `src/services/transcription/volcanoAsr.ts` — cloud (火山引擎豆包) engine
- `src/services/settings.ts` — engine/model preferences
