import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from 'react';
import {
  View, Text, Pressable, Alert, ActivityIndicator,
  StyleSheet, GestureResponderEvent, AppState,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList, Segment, Word, SavedItemType, PlaybackRate } from '../types';
import { type Palette } from '../constants/colors';
import { useTheme } from '../theme/ThemeProvider';
import { usePlaybackStore, type RepeatMode } from '../store/playbackStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { useLibraryStore } from '../store/libraryStore';
import {
  loadAudio, unloadAudio, play, pause, seekTo,
  seekToWord as audioSeekToWord, setPlaybackRate, skip, setOnTrackEnd,
} from '../services/audio';
import { formatPosition, formatDuration } from '../utils/timeFormat';
import { sortFiles } from '../utils/fileSort';
import { getFileSortMode, type FileSortMode } from '../services/settings';
import { getAudioFileSize } from '../services/filePicker';
import { lookupWord } from '../services/dictionary';
import { log } from '../utils/logger';
import SuggestionsModal from '../components/SuggestionsModal';
import ScrollIndicator, { type ScrollIndicatorHandle } from '../components/ScrollIndicator';

type Props = NativeStackScreenProps<HomeStackParamList, 'ContentView'>;
type Styles = ReturnType<typeof makeStyles>;

const PLAYBACK_RATES: PlaybackRate[] = [0.75, 1, 1.25, 1.5];

// ─── Word chip ────────────────────────────────────────────────────────────────
// Receives `styles` from its SegmentRow parent so a StyleSheet isn't rebuilt for
// every word (there are thousands) — only once per visible segment.

const WordChip = memo(({
  word, isActive, isSelected, onPress, onLongPress, styles,
}: {
  word: Word;
  isActive: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
  styles: Styles;
}) => (
  <Pressable onPress={onPress} onLongPress={onLongPress} hitSlop={4}>
    <Text style={[
      styles.word,
      isActive    && styles.wordActive,
      isSelected  && styles.wordSelected,
    ]}>
      {word.word}{' '}
    </Text>
  </Pressable>
));

// ─── Segment row ──────────────────────────────────────────────────────────────

interface SegmentItem { segment: Segment; words: Word[] }

const SegmentRow = memo(({ segment, words }: SegmentItem) => {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  // Only re-renders when the active word enters/leaves this segment's range
  const activeWordIndex = usePlaybackStore(s =>
    s.activeWordIndex >= segment.wordStartIndex && s.activeWordIndex <= segment.wordEndIndex
      ? s.activeWordIndex : -1
  );
  const selectionStart  = usePlaybackStore(s => s.selectionStart);
  const selectionEnd    = usePlaybackStore(s => s.selectionEnd);
  const loopSegment     = usePlaybackStore(s => s.loopSegment);
  const setLoopSegment  = usePlaybackStore(s => s.setLoopSegment);
  const setSelection    = usePlaybackStore(s => s.setSelection);
  const extendSelection = usePlaybackStore(s => s.extendSelection);
  const clearSelection  = usePlaybackStore(s => s.clearSelection);

  const isLooping = loopSegment?.id === segment.id;

  const handleWordPress = useCallback((wordIndex: number) => {
    if (selectionStart !== null) {
      const end = selectionEnd ?? selectionStart;
      // Tapping a word already inside the selection cancels it; otherwise extend
      if (wordIndex >= selectionStart && wordIndex <= end) clearSelection();
      else extendSelection(wordIndex);
    } else {
      audioSeekToWord(wordIndex);
    }
  }, [selectionStart, selectionEnd, extendSelection, clearSelection]);

  const handleWordLongPress = useCallback((wordIndex: number) => {
    setSelection(wordIndex, wordIndex);
  }, [setSelection]);

  return (
    <Pressable
      style={[styles.segment, isLooping && styles.segmentLooping]}
      onLongPress={() => setLoopSegment(isLooping ? null : segment)}
      // Tapping the blank area of a segment while selecting cancels the selection
      onPress={() => { if (selectionStart !== null) clearSelection(); }}
    >
      <View style={styles.wordRow}>
        {words.map(w => {
          const isActive   = w.wordIndex === activeWordIndex;
          const isSelected = selectionStart !== null &&
            w.wordIndex >= selectionStart &&
            w.wordIndex <= (selectionEnd ?? selectionStart);
          return (
            <WordChip
              key={w.wordIndex}
              word={w}
              isActive={isActive}
              isSelected={isSelected}
              onPress={() => handleWordPress(w.wordIndex)}
              onLongPress={() => handleWordLongPress(w.wordIndex)}
              styles={styles}
            />
          );
        })}
      </View>
      {isLooping && (
        <Text style={styles.loopLabel}>↻ Looping</Text>
      )}
    </Pressable>
  );
});

// ─── Seek bar ─────────────────────────────────────────────────────────────────

function SeekBar({ position, duration }: { position: number; duration: number }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [barWidth, setBarWidth] = useState(0);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const handlePress = (e: GestureResponderEvent) => {
    if (barWidth === 0 || duration === 0) return;
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth));
    seekTo(ratio * duration);
  };

  // Keep the thumb fully inside the track at both extremes.
  const thumbLeft = Math.max(0, Math.min(barWidth - 14, barWidth * progress - 7));

  return (
    <Pressable
      style={styles.seekTouchArea}
      onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
      onPress={handlePress}
    >
      <View style={styles.seekTrack}>
        <View style={[styles.seekFill, { width: barWidth * progress }]} />
      </View>
      <View style={[styles.seekThumb, { left: thumbLeft }]} />
    </Pressable>
  );
}

// ─── Audio player bar ─────────────────────────────────────────────────────────

function AudioPlayerBar({ audioFileId, onPlay }: { audioFileId: number; onPlay?: () => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const isPlaying      = usePlaybackStore(s => s.isPlaying);
  const currentPosition = usePlaybackStore(s => s.currentPosition);
  const playbackRate   = usePlaybackStore(s => s.playbackRate);
  const repeatMode     = usePlaybackStore(s => s.repeatMode);
  const setRepeatMode  = usePlaybackStore(s => s.setRepeatMode);
  const audioFile      = useAudioFilesStore(s => s.audioFiles.find(f => f.id === audioFileId));
  const duration       = audioFile?.duration ?? 0;

  const cycleRate = () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(next);
  };

  // off → one (repeat this file) → all (play category in order) → off
  const cycleRepeat = () => {
    const next: RepeatMode = repeatMode === 'off' ? 'one' : repeatMode === 'one' ? 'all' : 'off';
    setRepeatMode(next);
  };
  const repeatActive = repeatMode !== 'off';

  return (
    <View style={styles.playerBar}>
      <SeekBar position={currentPosition} duration={duration} />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatPosition(currentPosition)}</Text>
        <Text style={styles.timeText}>{duration > 0 ? formatDuration(duration) : '--:--'}</Text>
      </View>

      {/* Three balanced zones: rate (left) | transport (center) | repeat (right).
          The side zones share flex:1 and the side chips share one size, so the
          play button sits exactly at the horizontal center of the screen. */}
      <View style={styles.controls}>
        <View style={styles.sideZoneLeft}>
          <Pressable style={styles.sideChip} onPress={cycleRate}>
            <Text style={styles.rateText}>{playbackRate}×</Text>
          </Pressable>
        </View>

        <View style={styles.transport}>
          <Pressable style={styles.skipBtn} onPress={() => skip(-10)} hitSlop={6}>
            <Ionicons name="play-back" size={20} color={c.text} />
            <Text style={styles.skipLabel}>10</Text>
          </Pressable>
          <Pressable
            style={styles.playBtn}
            onPress={() => { if (isPlaying) { pause(); } else { play(); onPlay?.(); } }}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={30}
              color="#fff"
              // the play triangle is optically left-heavy — nudge it right
              style={isPlaying ? undefined : { marginLeft: 3 }}
            />
          </Pressable>
          <Pressable style={styles.skipBtn} onPress={() => skip(10)} hitSlop={6}>
            <Ionicons name="play-forward" size={20} color={c.text} />
            <Text style={styles.skipLabel}>10</Text>
          </Pressable>
        </View>

        <View style={styles.sideZoneRight}>
          <Pressable
            style={[styles.sideChip, repeatActive && styles.sideChipActive]}
            onPress={cycleRepeat}
          >
            <Ionicons name="repeat" size={16} color={repeatActive ? c.primary : c.textSecondary} />
            {repeatMode === 'one' && <Text style={styles.repeatBadge}>1</Text>}
            {repeatMode === 'all' && <Text style={styles.repeatBadge}>∞</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Selection / save bar ─────────────────────────────────────────────────────

function SelectionBar({ audioFileId }: { audioFileId: number }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const transcript    = usePlaybackStore(s => s.transcript);
  const selectionStart = usePlaybackStore(s => s.selectionStart);
  const selectionEnd  = usePlaybackStore(s => s.selectionEnd);
  const setSelection  = usePlaybackStore(s => s.setSelection);
  const clearSelection = usePlaybackStore(s => s.clearSelection);
  const addItem       = useLibraryStore(s => s.addItem);

  if (selectionStart === null || !transcript) return null;

  const end   = selectionEnd ?? selectionStart;
  const count = end - selectionStart + 1;

  const extendLeft = () => {
    if (selectionStart > 0) setSelection(selectionStart - 1, end);
  };
  const extendRight = () => {
    if (end < transcript.words.length - 1) setSelection(selectionStart, end + 1);
  };
  const selectWholeSentence = () => {
    const seg = transcript.segments.find(
      s => selectionStart >= s.wordStartIndex && selectionStart <= s.wordEndIndex
    );
    if (seg) setSelection(seg.wordStartIndex, Math.max(seg.wordEndIndex, end));
  };

  const selectedText = transcript.words
    .slice(selectionStart, end + 1)
    .map(w => w.word)
    .join(' ');

  const contextSentence = transcript.segments.find(
    s => selectionStart >= s.wordStartIndex && selectionStart <= s.wordEndIndex
  )?.text ?? selectedText;

  const startTime = transcript.words[selectionStart]?.start ?? 0;
  const endTime   = transcript.words[end]?.end ?? 0;

  const handleSave = async (type: SavedItemType) => {
    try {
      await addItem({
        audioFileId,
        text: selectedText,
        contextSentence,
        startTime,
        endTime,
        type,
        mastery: 'new',
      });
      clearSelection();
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Failed to save item');
    }
  };

  return (
    <View style={styles.selectionBar}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionText} numberOfLines={2}>"{selectedText}"</Text>
        <Pressable onPress={clearSelection} hitSlop={8}>
          <Ionicons name="close-circle" size={22} color={c.textSecondary} />
        </Pressable>
      </View>

      {/* Instant offline dictionary for single-word selections */}
      {count === 1 && (() => {
        const entry = lookupWord(selectedText);
        if (!entry) return null;
        return (
          <Text style={styles.dictLine} numberOfLines={2}>
            {entry.phonetic ? `/${entry.phonetic}/  ` : ''}
            {entry.translation.split('\n').slice(0, 2).join('；')}
          </Text>
        );
      })()}

      <Text style={styles.selectionHint}>
        {count} word{count > 1 ? 's' : ''} — tap any word in the transcript to extend the selection
      </Text>

      <View style={styles.selectionActions}>
        <Pressable style={styles.extendBtn} onPress={extendLeft} hitSlop={4}>
          <Ionicons name="chevron-back" size={16} color={c.primary} />
          <Text style={styles.extendBtnText}>1</Text>
        </Pressable>
        <Pressable style={styles.extendBtn} onPress={extendRight} hitSlop={4}>
          <Text style={styles.extendBtnText}>1</Text>
          <Ionicons name="chevron-forward" size={16} color={c.primary} />
        </Pressable>
        <Pressable style={styles.extendBtn} onPress={selectWholeSentence} hitSlop={4}>
          <Ionicons name="text-outline" size={14} color={c.primary} />
          <Text style={styles.extendBtnText}> Whole sentence</Text>
        </Pressable>
      </View>

      <View style={styles.selectionActions}>
        <Text style={styles.saveAsLabel}>Save as</Text>
        <Pressable style={styles.saveTypeBtn} onPress={() => handleSave('word')}>
          <Text style={styles.saveTypeBtnText}>Word</Text>
        </Pressable>
        <Pressable style={styles.saveTypeBtn} onPress={() => handleSave('phrase')}>
          <Text style={styles.saveTypeBtnText}>Phrase</Text>
        </Pressable>
        <Pressable style={styles.saveTypeBtn} onPress={() => handleSave('sentence')}>
          <Text style={styles.saveTypeBtnText}>Sentence</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── ContentViewScreen ────────────────────────────────────────────────────────

export default function ContentViewScreen({ route, navigation }: Props) {
  const { audioFileId } = route.params;
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const transcript     = usePlaybackStore(s => s.transcript);
  const activeWordIndex = usePlaybackStore(s => s.activeWordIndex);
  const audioFile      = useAudioFilesStore(s => s.audioFiles.find(f => f.id === audioFileId));
  const audioFiles     = useAudioFilesStore(s => s.audioFiles);

  const flashListRef = useRef<FlashListRef<SegmentItem>>(null);
  const scrollIndicatorRef = useRef<ScrollIndicatorHandle>(null);
  const lastActiveSegmentRef = useRef(-1);
  const autoPlayRef = useRef(false); // set when advancing to the next file in 'all' mode
  const sortModeRef = useRef<FileSortMode>('date');
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);

  // Keep the playlist order in sync with however the category screen is sorted,
  // so sequential playback advances in the order the user actually sees.
  useEffect(() => {
    void getFileSortMode().then(m => { sortModeRef.current = m; });
  }, []);

  // On return to the foreground, recompute the highlight from where playback
  // actually reached while the screen was locked (it was frozen there to avoid
  // background churn). The auto-scroll effect then snaps to it (big jump → no
  // animation) — this keeps unlock instant instead of freezing.
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        usePlaybackStore.getState().setPosition(usePlaybackStore.getState().currentPosition);
      }
    });
    return () => sub.remove();
  }, []);

  // Sequential playback ('all' / 顺序循环): when the current file ends, advance
  // to the next ready file in the same category — in the SAME order the category
  // screen shows — and auto-play it. Wraps around at the end (it's a loop), so
  // playback never gets stuck on the first or last file.
  useEffect(() => {
    setOnTrackEnd(() => {
      if (usePlaybackStore.getState().repeatMode !== 'all') return;
      const cat = audioFile?.categoryId ?? null;
      const inCat = audioFiles.filter(f => f.categoryId === cat && f.status === 'ready');
      if (inCat.length === 0) return;
      const sizes = new Map<number, number>();
      if (sortModeRef.current === 'size') {
        for (const f of inCat) {
          try { sizes.set(f.id, f.uri ? getAudioFileSize(f.uri) : 0); } catch { sizes.set(f.id, 0); }
        }
      }
      const ordered = sortFiles(inCat, sortModeRef.current, sizes);
      const idx = ordered.findIndex(f => f.id === audioFileId);
      if (idx < 0) return;
      const next = ordered[(idx + 1) % ordered.length];
      if (next.id === audioFileId) {
        // Only one file in the loop — just restart it.
        void seekTo(0).then(() => play());
        return;
      }
      autoPlayRef.current = true;
      navigation.setParams({ audioFileId: next.id });
    });
    return () => setOnTrackEnd(null);
  }, [audioFileId, audioFile?.categoryId, audioFiles, navigation]);

  // Prepare flat list data — recomputed only when transcript changes
  const segmentItems = useMemo<SegmentItem[]>(() => {
    if (!transcript) return [];
    return transcript.segments.map(seg => ({
      segment: seg,
      words: transcript.words.slice(seg.wordStartIndex, seg.wordEndIndex + 1),
    }));
  }, [transcript]);

  // Which segment indexes are currently on screen — used to decide whether
  // auto-scroll is needed at all.
  const visibleRangeRef = useRef({ first: -1, last: -1 });
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length === 0) return;
      visibleRangeRef.current = {
        first: viewableItems[0].index ?? -1,
        last: viewableItems[viewableItems.length - 1].index ?? -1,
      };
    }
  ).current;

  // Auto-scroll: when the active word enters a new segment, scroll to it —
  // but ONLY if that segment isn't already on screen. Without this check,
  // tapping a visible word yanks its line to the top of the list (under the
  // top bar) even though there was nothing to scroll to.
  useEffect(() => {
    if (!transcript || activeWordIndex < 0) return;
    const segIndex = transcript.segments.findIndex(
      s => activeWordIndex >= s.wordStartIndex && activeWordIndex <= s.wordEndIndex
    );
    if (segIndex === -1 || segIndex === lastActiveSegmentRef.current) return;
    const prevSeg = lastActiveSegmentRef.current;
    lastActiveSegmentRef.current = segIndex;

    const { first, last } = visibleRangeRef.current;
    if (first !== -1 && segIndex >= first && segIndex <= last) return; // already visible

    // Animate only small step-overs (normal playback). Snap with NO animation
    // for big jumps — after a seek, or returning from a lock where the highlight
    // skipped ahead — so FlashList doesn't churn the main thread animating
    // across hundreds of variable-height rows (the unlock-freeze cause).
    const animated = prevSeg >= 0 && Math.abs(segIndex - prevSeg) <= 3;
    try {
      // Land the line ~30% from the top — comfortable to read and clear of
      // the top bar (viewPosition is the fraction of the viewport).
      flashListRef.current?.scrollToIndex({
        index: segIndex,
        animated,
        viewPosition: 0.3,
      });
    } catch {}
  }, [activeWordIndex, transcript]);

  // Pressing play after manually scrolling away should bring the currently
  // playing line back into view — unconditionally (unlike the passive
  // auto-scroll above, which skips when nothing changed). Reads the store
  // directly to avoid a stale closure.
  const recenterActiveSegment = useCallback(() => {
    const { transcript: t, activeWordIndex: wi } = usePlaybackStore.getState();
    if (!t || wi < 0) return;
    const segIndex = t.segments.findIndex(
      s => wi >= s.wordStartIndex && wi <= s.wordEndIndex
    );
    if (segIndex < 0) return;
    try {
      flashListRef.current?.scrollToIndex({ index: segIndex, animated: true, viewPosition: 0.3 });
    } catch {}
  }, []);

  // Mount: load transcript + audio
  useEffect(() => {
    if (!audioFile) return;

    navigation.setOptions({ title: audioFile.title });

    let mounted = true;
    const store = usePlaybackStore.getState();

    void (async () => {
      try {
        const t0 = Date.now();
        await store.loadTranscript(audioFileId);
        const loaded = usePlaybackStore.getState().transcript;
        log.info('content', `transcript loaded id=${audioFileId}: ${loaded?.segments.length} segments, ${loaded?.words.length} words in ${Date.now() - t0}ms`);
        if (mounted) {
          await loadAudio(audioFile.uri, audioFileId, audioFile.title);
          log.info('content', `audio loaded id=${audioFileId}`);
          if (autoPlayRef.current) {
            // Arrived here via sequential auto-advance — start from the top
            autoPlayRef.current = false;
            await play();
          } else {
            // Resume where the user left off — unless they were at the very
            // start or had effectively finished the episode.
            const resumeAt = audioFile.lastPosition;
            const nearEnd = audioFile.duration > 0 && resumeAt >= audioFile.duration * 0.98;
            if (resumeAt > 5 && !nearEnd) {
              await seekTo(resumeAt);
              usePlaybackStore.getState().setPosition(resumeAt);
            }
          }
        }
      } catch (e) {
        if (!mounted) return;
        Alert.alert('Open failed', e instanceof Error ? e.message : 'Failed to open audio');
        navigation.goBack();
      }
    })();

    return () => {
      mounted = false;
      void unloadAudio();
      usePlaybackStore.getState().unloadTranscript();
    };
  }, [audioFileId, audioFile?.uri, audioFile?.title, navigation]);

  if (!transcript) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={c.primary} />
        <Text style={styles.loadingText}>Loading transcript…</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* AI suggestion button */}
      <View style={styles.topBar}>
        <Text style={styles.segmentCount}>{segmentItems.length} segments</Text>
        <Pressable style={styles.suggestBtn} onPress={() => setSuggestionsVisible(true)}>
          <Ionicons name="sparkles" size={14} color={c.primary} />
          <Text style={styles.suggestText}> Suggest phrases</Text>
        </Pressable>
      </View>

      {/* Transcript — the wrapper View gives FlashList a bounded height.
          Without it the list sizes itself to its content in the column layout
          and virtualization breaks: every word of the transcript mounts at
          once, freezing the JS thread (and OOM-crashing on long files). */}
      <View style={styles.transcriptContainer}>
        <FlashList
          ref={flashListRef}
          data={segmentItems}
          keyExtractor={item => String(item.segment.id)}
          renderItem={({ item }) => <SegmentRow segment={item.segment} words={item.words} />}
          contentContainerStyle={styles.transcriptContent}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={e => scrollIndicatorRef.current?.onScroll(e)}
        />
        <ScrollIndicator ref={scrollIndicatorRef} />
      </View>

      {/* Selection bar (above player when words are selected) */}
      <SelectionBar audioFileId={audioFileId} />

      {/* Audio player */}
      <View style={[styles.playerContainer, { paddingBottom: insets.bottom }]}>
        <AudioPlayerBar audioFileId={audioFileId} onPlay={recenterActiveSegment} />
      </View>

      <SuggestionsModal
        visible={suggestionsVisible}
        onClose={() => setSuggestionsVisible(false)}
        audioFileId={audioFileId}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Palette) {
  return StyleSheet.create({
  screen:           { flex: 1, backgroundColor: c.background },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  loadingText:      { marginTop: 12, color: c.textSecondary, fontSize: 14 },

  topBar:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  segmentCount:     { fontSize: 12, color: c.textSecondary },
  suggestBtn:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.primaryLight, borderRadius: 20 },
  suggestText:      { fontSize: 12, color: c.primary, fontWeight: '600' },

  transcriptContainer: { flex: 1 },
  transcriptContent: { padding: 16, paddingBottom: 8 },
  segment:          { marginBottom: 16, padding: 10, borderRadius: 10 },
  segmentLooping:   { backgroundColor: c.primaryLight, borderWidth: 1, borderColor: c.primary },
  wordRow:          { flexDirection: 'row', flexWrap: 'wrap' },
  loopLabel:        { fontSize: 11, color: c.primary, fontWeight: '600', marginTop: 4 },

  word:             { fontSize: 16, color: c.text, lineHeight: 26 },
  wordActive:       { color: '#fff', backgroundColor: c.primary, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 2 },
  wordSelected:     { backgroundColor: c.selectedWord, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 2 },

  selectionBar:     { backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border, padding: 12 },
  selectionHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  selectionText:    { flex: 1, fontSize: 13, color: c.text, fontStyle: 'italic', marginBottom: 4 },
  selectionHint:    { fontSize: 11, color: c.textSecondary, marginBottom: 8 },
  dictLine:         { fontSize: 13, color: c.primary, marginBottom: 6, lineHeight: 19 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  extendBtn:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: c.primaryLight },
  extendBtnText:    { fontSize: 12, color: c.primary, fontWeight: '600' },
  saveAsLabel:      { fontSize: 12, color: c.textSecondary, marginRight: 2 },
  saveTypeBtn:      { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  saveTypeBtnText:  { color: '#fff', fontSize: 13, fontWeight: '600' },

  playerContainer:  { backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border },
  playerBar:        { padding: 16 },

  // 24px-tall touch area around a 4px visual track — easy to tap precisely.
  seekTouchArea:    { height: 24, justifyContent: 'center', marginBottom: 2 },
  seekTrack:        { height: 4, backgroundColor: c.border, borderRadius: 2, overflow: 'hidden' },
  seekFill:         { height: 4, backgroundColor: c.primary, borderRadius: 2 },
  seekThumb:        { width: 14, height: 14, borderRadius: 7, backgroundColor: c.primary, position: 'absolute', top: 5, borderWidth: 2, borderColor: c.surface, elevation: 2, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },

  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  timeText:         { fontSize: 12, color: c.textSecondary, fontVariant: ['tabular-nums'] },

  controls:         { flexDirection: 'row', alignItems: 'center' },
  sideZoneLeft:     { flex: 1, alignItems: 'flex-start' },
  sideZoneRight:    { flex: 1, alignItems: 'flex-end' },
  // Rate and repeat share one chip shape so the two sides mirror each other.
  sideChip:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 56, height: 34, paddingHorizontal: 10, borderRadius: 17, backgroundColor: c.primaryLight },
  sideChipActive:   { borderWidth: 1.5, borderColor: c.primary },
  rateText:         { fontSize: 13, fontWeight: '700', color: c.primary, fontVariant: ['tabular-nums'] },
  repeatBadge:      { fontSize: 11, fontWeight: '700', color: c.primary },

  transport:        { flexDirection: 'row', alignItems: 'center', gap: 24 },
  skipBtn:          { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  skipLabel:        { position: 'absolute', bottom: 1, fontSize: 9, fontWeight: '700', color: c.textSecondary },
  playBtn:          { width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', elevation: 3, shadowColor: c.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  });
}
