# Earmark — Project Context

> App display name is **Earmark** (ear + mark = save what you hear; also a real English verb meaning "to set aside for a purpose"). The Expo `slug` remains `postcast-assistant` (internal EAS identity — don't change it).

## What This Project Is

A mobile tool to help English learners learn more effectively through audio content (podcasts, lessons, etc.). The user brings their own audio files — the tool does not provide any content itself. It processes local audio files from the phone, transcribes them, and provides utilities to capture and review vocabulary, phrases, and sentences.

The user is a Chinese developer learning English who regularly listens to podcasts. The core problem: useful phrases are heard but quickly forgotten. This tool solves that by enabling capture, context preservation, and active review.

## User Background

- Learning English, uses podcasts as a primary resource
- Has JavaScript experience
- Working in WSL (Ubuntu 22.04) on Windows 11
- New to React Native / mobile development

## Tech Stack Decisions

| Decision | Choice | Reason |
|---|---|---|
| Framework | React Native + Expo | User has JS experience; Expo simplifies setup and cross-platform support |
| IDE | VS Code (connected to WSL) | JS familiarity; handles both mobile app and future backend in one window |
| Language | TypeScript | Better for a larger multi-screen project |
| State management | Zustand | Lightweight, simple API, works well with React Native |
| List rendering | FlashList (@shopify/flash-list) | High-performance virtualized lists for long transcripts |
| Audio | expo-audio | Expo-native audio playback |
| File picker | expo-document-picker | Pick local audio files from phone storage |
| Local storage | expo-sqlite | Persist saved vocabulary, phrases, sentences |
| Transcription (default) | On-device whisper.cpp via whisper.rn | Fully offline, free, no file size limit; word-level timestamps via tokenTimestamps + maxLen=1 |
| Transcription (fallback) | 火山引擎 豆包大模型 ASR (录音文件识别极速版) | Optional cloud engine (Settings); word-level timestamps, official AUC audio URL flow, 100 MB / 2 h limit |
| Pronunciation readout (TTS) | 火山引擎 豆包语音合成 (bigtts, same API Key as ASR) + system TTS fallback | Dictionary-quality neural voices; synthesized audio cached on disk → offline replay |
| Audio decode (offline path) | react-native-audio-api | Decodes mp3/m4a → 16 kHz mono WAV that whisper.cpp requires |
| AI features | 豆包 LLM (火山方舟, doubao-seed-1.6-flash) or DeepSeek — selectable in Settings | Phrase suggestions + learning notes; opt-in, online-only, cached in SQLite. 方舟 API Key 与语音 API Key 是两套体系 |

## Scope Decisions

- **V1: Local audio files only.** Users pick audio files already on their phone. No URL parsing, no Bilibili/YouTube extraction. URL support is a future feature.
- **Offline-first.** Transcription runs on-device by default (whisper.cpp); the app is fully usable in airplane mode. Only optional AI suggestions and one-time Whisper model downloads need internet. See `OFFLINE_SETUP.md`.
- **No backend.** Any API calls (火山引擎 ASR/TTS, 豆包方舟/DeepSeek LLM) are made directly from the mobile app. Acceptable for a personal tool. Never hardcode API keys in source — keys live in SecureStore only.
- **Dev build required for the offline engine.** whisper.rn and react-native-audio-api are native modules — `npx expo prebuild` + `npx expo run:android` (or EAS). The app still runs in Expo Go with the cloud engine; local-engine modules are lazily require()d.
- **Android first.** iOS support is available later for free via React Native/Expo.

## Core Workflow

```
User picks a local audio file from phone
        ↓
App sends audio to Whisper API → transcript with word-level timestamps
        ↓
User reads transcript (synced with audio playback), taps to save phrases
        ↓
Saved items stored locally (SQLite)
        ↓
User reviews saved items via flashcard/quiz mode
```

## Screens & Feature Specifications

### 1. Home Screen
- List of all added audio files with processing status (pending / transcribing / ready)
- Tap a file to open Content View
- Button to pick a new audio file from phone storage
- Show metadata: title, duration, date added, number of saved phrases

### 2. Content View (High Priority — Performance + Rich Features)

**Technical performance:**
- Word-level transcript sync — the spoken word highlights in real time as audio plays
- Virtualized transcript rendering (FlashList) so long transcripts don't freeze the UI
- Smooth seek and playback with no jank

**Learning features:**
- Tap-to-seek — tap any word in the transcript to jump audio to that moment
- Smart phrase selection — tap one word to select, drag to extend selection to a full phrase or sentence
- Loop a sentence — double-tap a sentence to loop it repeatedly (for shadowing/pronunciation practice)
- Playback speed control — 0.75x, 1x, 1.25x, 1.5x
- Save selected phrase/word/sentence with one tap; saves with full sentence context and timestamp
- AI-suggested phrases — the AI provider can highlight phrases worth learning at the user's level

### 3. Library Screen (Friendly UI + Rich Functions)
- All saved vocabulary, phrases, and sentences across all audio files
- **Rich cards**: each item shows the saved phrase + full surrounding sentence + source file name + timestamp
- **Filter by type**: words / phrases / full sentences
- **Search**: find any saved item instantly
- **Mastery tags**: mark items as New / Learning / Mastered
- **Sort**: by date added, mastery level
- Swipe to delete or archive

### 4. Review Screen (Friendly UI + Rich Functions)
- **Multiple quiz modes**:
  - Flashcard: show phrase → user recalls meaning
  - Fill-in-the-blank: show sentence with word removed, user types it
  - Listen-and-identify: play audio clip, user identifies the phrase
- **Spaced repetition**: items struggled with appear more frequently
- **Progress stats**: daily streak, items reviewed today, mastery rate per source file
- **Play original audio clip** during review (hear native pronunciation in context)
- Visual progress indicators per item (New → Learning → Mastered)

## Navigation Structure

- **Bottom Tab Navigator**: Home | Library | Review
- **Stack Navigator**: Home → Content View (pushed on file tap)

## Project Location

- **Working directory**: `/home/daryl/projects/go-podcast-assistant` (WSL Ubuntu-22.04)
- **Windows path**: `\\wsl.localhost\Ubuntu-22.04\home\daryl\projects\go-podcast-assistant`
- Node.js v20.20.2 available in WSL

## Current State

- All 4 screens built and functional (Home, Content View, Library, Review)
- SQLite schema with migrations (v9): audio_files (category_id, last_position, sort_order), categories, segments, words, saved_items (nullable audio_file_id + ON DELETE SET NULL, clip_uri, source_title, enrichment, note, SM-2: ease_factor/interval_days/review_count), suggestion_cache, review_log
- Data safety: JSON backup export/import (merge-safe, Settings → Data & storage); stuck 'transcribing' rows auto-recover to 'error' at startup. Backup (v2, services/backup.ts) includes categories, audio-file metadata, the full transcript (segments+words), saved items (incl. enrichment) and review_log — everything EXCEPT audio binaries, so it stays small. Restored audio files are placeholders (empty uri, status 'error') carrying their transcript; re-importing the same-titled audio adopts the placeholder (db/queries/audioFiles.ts insertAudioFile matches uri='' + title) → status flips to 'ready', saved-item playback/looping/review reconnect with no re-transcription. Import accepts v1 (no transcript) and v2
- Audio/saved-item coupling: deleting an audio file ALSO deletes its saved words/phrases/sentences (services/fileDeletion.ts deleteAudioFileAndItems; review_log kept so streak survives). Review plays the ORIGINAL audio sliced live from the source file (text-corrected bounds via services/sentenceLocator.ts) — no extracted-clip files. The old clip-extraction pipeline was removed; services/clips.ts only cleans up legacy leftover clips. saved_items.clip_uri column is retained but unused for new items.
- Listening UX: per-file playback position persisted (resume on open, "% listened" on cards); storage management screen (per-file sizes, remove-audio-keep-cards)
- Review retention: daily local notification reminder (expo-notifications, Settings toggle + time presets); saved items editable (fix Whisper errors) via pencil icon in item detail
- Settings (Chinese UI): hub page with readiness status per feature + sub-pages (转写引擎/发音朗读/AI 学习笔记/数据与存储, src/components/settings/); engine page shows only the selected mode's config with ready/missing-step badges; API keys live in the pages that use them and auto-save on blur; AI notes has a master toggle (settings.aiEnabled, gates auto-enrichment)
- Categories (folder model): Home is a category overview (user categories + built-in "Uncategorized"); CategoryScreen shows a category's files, imports into that category, multi-select supports move-to-category and delete; deleting a category returns its files to Uncategorized
- Category file list UX: search by title; sort cycle 按添加时间/文件名/大小/自定义 (manual order via audio_files.sort_order, migration v7, ↑↓ buttons); multi-file import (no auto-transcription — tap pending card or multi-select 转写 for a sequential queue); multi-delete shows a progress overlay; long titles horizontally scrollable
- Transcription engine abstraction: on-device whisper.cpp (default) + 火山引擎豆包 cloud (optional), selected in Settings; one 火山 API Key powers both cloud ASR and 豆包 TTS (services/volcano.ts, services/transcription/volcanoAsr.ts)
- Pronunciation readout: 豆包 bigtts neural voices (8 EN presets, US/UK/AU) with per-text disk cache (document/tts-cache) and automatic fallback to system TTS (expo-speech) when offline/unconfigured — Settings → Pronunciation
- Whisper model manager: download/delete tiny.en / base.en / small.en (q5_1) from Hugging Face with progress UI
- Review (memory-science redesign): single "今日复习" entry — no mode picker. One session interleaves the three modes, auto-chosen per item by mastery (new→flashcard/listen, learning→listen, mastered→fill-in-blank). SM-2 4-grade scheduling (重来/有点难/记得/很容易) in utils/spacedRepetition.ts (computeSrs); wrong answers shorten interval + lower ease instead of resetting; mastery is derived from interval_days for display. Flashcard shows the 4 grade buttons; typed/MC modes map correct→good, wrong→again. reviewStore holds ReviewCard[] (item+mode); libraryStore.applySrs persists state
- Library: search, type/mastery filters, sort (newest/oldest/mastery/A–Z)
- Daily streak + reviewed-today stats via review_log
- AI phrase suggestions modal (豆包方舟 or DeepSeek, optional, cached per file; services/ai.ts + services/suggestions.ts)

## Deployment

EAS Build/Update workflow (development / preview / production profiles, OTA updates, runtimeVersion=appVersion caveats) is documented in `deployment.md`.

## Next Steps

1. Run a development build for the offline engine: `npx expo prebuild --platform android` then `npx expo run:android` (see OFFLINE_SETUP.md)
2. Test on-device transcription end-to-end on a real phone (decode → whisper → word sync accuracy)
3. Possible future: offline Chinese-English dictionary (ECDICT) for tap-word definitions; export saved items to Anki; URL/podcast-feed import
