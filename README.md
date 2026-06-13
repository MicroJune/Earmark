# Earmark 🎧

**Learn English from the podcasts you already listen to.** Import an audio file,
get a word-synced transcript, tap to save the words and phrases you hear, and
review them with spaced repetition — fully offline, on your phone.

> *ear + mark — to set aside what you hear.*

中文简介:Earmark 是一款帮助中文母语者通过播客学英语的开源 App。导入本地音频
→ 离线转写出逐词对齐的文稿 → 点选生词/短语保存(带原句、原声、翻译)→ 用
间隔重复(SM‑2)复习。转写与词典完全离线,无需账号、无后端、数据只存在你手机上。

---

## Why

Listening to English podcasts is great input, but useful words and phrases fly
by and are forgotten minutes later. Earmark turns passive listening into active
vocabulary: it transcribes your own audio, lets you capture phrases *in context*,
and brings them back at the right time for review.

It is **offline-first** and **private**: transcription runs on-device, your audio
never leaves the phone, there's no account and no server.

## Features

- **🎙 On-device transcription** — whisper.cpp running locally produces word-level
  timestamps, so the spoken word highlights in real time as the audio plays.
  Works in airplane mode. An optional cloud engine (火山引擎 豆包 ASR) is available too.
- **📂 Categories** — organize files into folders; search, sort (by name / date /
  size / custom drag order), batch transcribe, and multi-select move/delete.
- **👆 Capture in context** — tap any word to seek; tap-and-drag to select a phrase
  or whole sentence; save it with its surrounding sentence, timestamp and the
  original audio clip.
- **📖 Offline dictionary** — tap a single word for an instant CN–EN definition
  (bundled ECDICT), no network needed.
- **🧠 Spaced-repetition review** — a single "today's review" session that
  interleaves three retrieval modes (flashcard, fill-in-the-blank, listen &
  identify), auto-chosen per item by mastery, scheduled with an **SM-2** 4-grade
  algorithm (Again / Hard / Good / Easy). Reviewing plays the **original podcast
  audio** of each phrase.
- **🔊 Pronunciation** — neural TTS (火山引擎 豆包 voices, US/UK/AU) with a system-TTS
  fallback; synthesized audio is cached on disk for offline replay.
- **✨ AI learning notes & suggestions** (optional) — translation, synonyms,
  example sentences, and "phrases worth learning" picked from a transcript, via
  豆包 (火山方舟) or DeepSeek. Online-only, opt-in, cached per item.
- **🎵 Background playback** — lock-screen / notification media controls and
  resume-where-you-left-off.
- **💾 Your data, your control** — JSON backup export/import (merge-safe), a
  storage manager, and a daily review reminder. API keys live only in the
  device's secure storage and are never hardcoded or uploaded.

## Screenshots

> _Add screenshots here, e.g._
> `docs/screenshots/home.png`, `content-view.png`, `review.png`, `library.png`.

## Tech stack

| Area | Choice |
|---|---|
| Framework | React Native + [Expo](https://expo.dev) (SDK 56) |
| Language | TypeScript |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Lists | [@shopify/flash-list](https://shopify.github.io/flash-list/) |
| Storage | `expo-sqlite` (versioned migrations) |
| Playback | `expo-audio` |
| On-device ASR | [whisper.rn](https://github.com/mybigday/whisper.rn) (whisper.cpp) |
| Audio decode | [react-native-audio-api](https://github.com/software-mansion/react-native-audio-api) |
| Cloud ASR / TTS | 火山引擎 豆包 (optional) |
| AI notes | 豆包 (火山方舟) or DeepSeek (optional) |

No backend — every network call (optional cloud ASR/TTS/AI) is made directly
from the app.

## Getting started

> The on-device transcription engine uses **native modules**, so it needs a
> *development build* — it does **not** run in Expo Go. In Expo Go you can still
> use the app with the cloud transcription engine.

### Prerequisites

- Node.js 20+
- An Android device or emulator (Android is the primary target; iOS works via
  React Native/Expo but is untested)
- For the offline engine / native build: Android Studio + SDK, **or** an
  [Expo EAS](https://docs.expo.dev/build/introduction/) account for cloud builds

### Run a development build

```bash
git clone https://github.com/<your-username>/earmark.git
cd earmark
npm install

# Generate the native android/ project (config plugins applied automatically)
npx expo prebuild --platform android

# Build & install on a connected device/emulator…
npx expo run:android
# …or build in the cloud with EAS:
npx eas build --profile development --platform android
```

After the dev build is installed once, day-to-day work is just
`npx expo start` opened from the dev build app.

See **[OFFLINE_SETUP.md](OFFLINE_SETUP.md)** for the offline engine in detail and
**[DEVELOPMENT.md](DEVELOPMENT.md)** for local dev notes (incl. running over USB
from WSL).

### Optional API keys

All transcription (on-device) and the dictionary work with **no keys at all**.
Keys are only needed for optional online features and are entered in-app
(Settings → they're stored in the OS secure store, never in the repo):

- **火山引擎 语音** — cloud transcription + 豆包 neural TTS (one key for both)
- **火山方舟** or **DeepSeek** — AI suggestions & learning notes

## Project structure

```
src/
  screens/      Home, Category, Content View, Library, Review
  components/   modals, settings sub-pages, reusable UI
  services/     transcription/ (whisper + cloud), audio, tts, ai,
                dictionary, backup, reminders, fileDeletion, clips …
  store/        Zustand stores (audioFiles, library, review, playback)
  db/           SQLite schema, migrations, per-table queries
  utils/        spacedRepetition (SM-2), sentence/word helpers
```

`CLAUDE.md` contains a detailed architecture/decision log.

## Privacy

- Audio files are processed **on-device**; they are never uploaded for the
  default (offline) transcription engine.
- There is no account and no analytics/telemetry.
- Optional cloud features (cloud ASR, TTS, AI notes) send only the text/audio
  needed for that feature to the provider you configured, using your own API key.

## Contributing

Issues and pull requests are welcome. This started as a personal tool, so expect
some rough edges. If you're filing a bug, the in-app **Settings → 运行日志 (Logs)**
screen can export logs that help.

## License

[MIT](LICENSE) — free to use, modify and distribute.

## Acknowledgements

Built on the work of [whisper.cpp](https://github.com/ggerganov/whisper.cpp) /
[whisper.rn](https://github.com/mybigday/whisper.rn),
[Expo](https://expo.dev), and the [ECDICT](https://github.com/skywind3000/ECDICT)
English–Chinese dictionary.
