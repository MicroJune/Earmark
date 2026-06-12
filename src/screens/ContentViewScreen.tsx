import React, { useEffect, useRef, useState, memo, useMemo, useCallback } from 'react';
import {
  View, Text, Pressable, Alert, ActivityIndicator,
  StyleSheet, GestureResponderEvent,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList, Segment, Word, SavedItemType, PlaybackRate } from '../types';
import { COLORS } from '../constants/colors';
import { usePlaybackStore } from '../store/playbackStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { useLibraryStore } from '../store/libraryStore';
import {
  loadAudio, unloadAudio, play, pause, seekTo,
  seekToWord as audioSeekToWord, setPlaybackRate, skip,
} from '../services/audio';
import { formatPosition, formatDuration } from '../utils/timeFormat';
import { lookupWord } from '../services/dictionary';
import { log } from '../utils/logger';
import SuggestionsModal from '../components/SuggestionsModal';

type Props = NativeStackScreenProps<HomeStackParamList, 'ContentView'>;

const PLAYBACK_RATES: PlaybackRate[] = [0.75, 1, 1.25, 1.5];

// ─── Word chip ────────────────────────────────────────────────────────────────

const WordChip = memo(({
  word, isActive, isSelected, onPress, onLongPress,
}: {
  word: Word;
  isActive: boolean;
  isSelected: boolean;
  onPress: () => void;
  onLongPress: () => void;
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

  const isLooping = loopSegment?.id === segment.id;

  const handleWordPress = useCallback((wordIndex: number) => {
    if (selectionStart !== null) extendSelection(wordIndex);
    else audioSeekToWord(wordIndex);
  }, [selectionStart, extendSelection]);

  const handleWordLongPress = useCallback((wordIndex: number) => {
    setSelection(wordIndex, wordIndex);
  }, [setSelection]);

  return (
    <Pressable
      style={[styles.segment, isLooping && styles.segmentLooping]}
      onLongPress={() => setLoopSegment(isLooping ? null : segment)}
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
  const [barWidth, setBarWidth] = useState(0);
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const handlePress = (e: GestureResponderEvent) => {
    if (barWidth === 0 || duration === 0) return;
    const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth));
    seekTo(ratio * duration);
  };

  return (
    <Pressable
      style={styles.seekTrack}
      onLayout={e => setBarWidth(e.nativeEvent.layout.width)}
      onPress={handlePress}
    >
      <View style={[styles.seekFill, { width: barWidth * progress }]} />
      <View style={[styles.seekThumb, { left: barWidth * progress - 6 }]} />
    </Pressable>
  );
}

// ─── Audio player bar ─────────────────────────────────────────────────────────

function AudioPlayerBar({ audioFileId }: { audioFileId: number }) {
  const isPlaying      = usePlaybackStore(s => s.isPlaying);
  const currentPosition = usePlaybackStore(s => s.currentPosition);
  const playbackRate   = usePlaybackStore(s => s.playbackRate);
  const audioFile      = useAudioFilesStore(s => s.audioFiles.find(f => f.id === audioFileId));
  const duration       = audioFile?.duration ?? 0;

  const cycleRate = () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(playbackRate) + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(next);
  };

  return (
    <View style={styles.playerBar}>
      <SeekBar position={currentPosition} duration={duration} />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatPosition(currentPosition)}</Text>
        <Text style={styles.timeText}>{duration > 0 ? formatDuration(duration) : '--:--'}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.controlBtn} onPress={() => skip(-10)}>
          <Ionicons name="play-back" size={22} color={COLORS.text} />
        </Pressable>
        <Pressable style={styles.playBtn} onPress={() => isPlaying ? pause() : play()}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color="#fff" />
        </Pressable>
        <Pressable style={styles.controlBtn} onPress={() => skip(10)}>
          <Ionicons name="play-forward" size={22} color={COLORS.text} />
        </Pressable>
        <Pressable style={styles.rateBtn} onPress={cycleRate}>
          <Text style={styles.rateText}>{playbackRate}×</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Selection / save bar ─────────────────────────────────────────────────────

function SelectionBar({ audioFileId }: { audioFileId: number }) {
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

  const inferType = (): SavedItemType => {
    if (count === 1) return 'word';
    if (count >= 6) return 'sentence';
    return 'phrase';
  };

  return (
    <View style={styles.selectionBar}>
      <View style={styles.selectionHeader}>
        <Text style={styles.selectionText} numberOfLines={2}>"{selectedText}"</Text>
        <Pressable onPress={clearSelection} hitSlop={8}>
          <Ionicons name="close-circle" size={22} color={COLORS.textSecondary} />
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
          <Ionicons name="chevron-back" size={16} color={COLORS.primary} />
          <Text style={styles.extendBtnText}>1</Text>
        </Pressable>
        <Pressable style={styles.extendBtn} onPress={extendRight} hitSlop={4}>
          <Text style={styles.extendBtnText}>1</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.primary} />
        </Pressable>
        <Pressable style={styles.extendBtn} onPress={selectWholeSentence} hitSlop={4}>
          <Ionicons name="text-outline" size={14} color={COLORS.primary} />
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

  const transcript     = usePlaybackStore(s => s.transcript);
  const activeWordIndex = usePlaybackStore(s => s.activeWordIndex);
  const audioFile      = useAudioFilesStore(s => s.audioFiles.find(f => f.id === audioFileId));

  const flashListRef = useRef<FlashListRef<SegmentItem>>(null);
  const lastActiveSegmentRef = useRef(-1);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);

  // Prepare flat list data — recomputed only when transcript changes
  const segmentItems = useMemo<SegmentItem[]>(() => {
    if (!transcript) return [];
    return transcript.segments.map(seg => ({
      segment: seg,
      words: transcript.words.slice(seg.wordStartIndex, seg.wordEndIndex + 1),
    }));
  }, [transcript]);

  // Auto-scroll: when the active word enters a new segment, scroll to it
  useEffect(() => {
    if (!transcript || activeWordIndex < 0) return;
    const segIndex = transcript.segments.findIndex(
      s => activeWordIndex >= s.wordStartIndex && activeWordIndex <= s.wordEndIndex
    );
    if (segIndex === -1 || segIndex === lastActiveSegmentRef.current) return;
    lastActiveSegmentRef.current = segIndex;
    try {
      flashListRef.current?.scrollToIndex({ index: segIndex, animated: true, viewOffset: 60 });
    } catch {}
  }, [activeWordIndex, transcript]);

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
          // Resume where the user left off — unless they were at the very
          // start or had effectively finished the episode.
          const resumeAt = audioFile.lastPosition;
          const nearEnd = audioFile.duration > 0 && resumeAt >= audioFile.duration * 0.98;
          if (resumeAt > 5 && !nearEnd) {
            await seekTo(resumeAt);
            usePlaybackStore.getState().setPosition(resumeAt);
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
        <ActivityIndicator size="large" color={COLORS.primary} />
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
          <Ionicons name="sparkles" size={14} color={COLORS.primary} />
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
        />
      </View>

      {/* Selection bar (above player when words are selected) */}
      <SelectionBar audioFileId={audioFileId} />

      {/* Audio player */}
      <View style={[styles.playerContainer, { paddingBottom: insets.bottom }]}>
        <AudioPlayerBar audioFileId={audioFileId} />
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

const styles = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: COLORS.background },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText:      { marginTop: 12, color: COLORS.textSecondary, fontSize: 14 },

  topBar:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  segmentCount:     { fontSize: 12, color: COLORS.textSecondary },
  suggestBtn:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: COLORS.primaryLight, borderRadius: 20 },
  suggestText:      { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  transcriptContainer: { flex: 1 },
  transcriptContent: { padding: 16, paddingBottom: 8 },
  segment:          { marginBottom: 16, padding: 10, borderRadius: 10 },
  segmentLooping:   { backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: COLORS.primary },
  wordRow:          { flexDirection: 'row', flexWrap: 'wrap' },
  loopLabel:        { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 4 },

  word:             { fontSize: 16, color: COLORS.text, lineHeight: 26 },
  wordActive:       { color: '#fff', backgroundColor: COLORS.primary, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 2 },
  wordSelected:     { backgroundColor: COLORS.selectedWord, borderRadius: 4, overflow: 'hidden', paddingHorizontal: 2 },

  selectionBar:     { backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, padding: 12 },
  selectionHeader:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  selectionText:    { flex: 1, fontSize: 13, color: COLORS.text, fontStyle: 'italic', marginBottom: 4 },
  selectionHint:    { fontSize: 11, color: COLORS.textSecondary, marginBottom: 8 },
  dictLine:         { fontSize: 13, color: COLORS.primary, marginBottom: 6, lineHeight: 19 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  extendBtn:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: COLORS.primaryLight },
  extendBtnText:    { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  saveAsLabel:      { fontSize: 12, color: COLORS.textSecondary, marginRight: 2 },
  saveTypeBtn:      { backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  saveTypeBtnText:  { color: '#fff', fontSize: 13, fontWeight: '600' },

  playerContainer:  { backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  playerBar:        { padding: 16 },

  seekTrack:        { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginBottom: 8 },
  seekFill:         { height: 4, backgroundColor: COLORS.primary, borderRadius: 2, position: 'absolute' },
  seekThumb:        { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary, position: 'absolute', top: -4 },

  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  timeText:         { fontSize: 12, color: COLORS.textSecondary },

  controls:         { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  controlBtn:       { padding: 8 },
  playBtn:          { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  rateBtn:          { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: COLORS.primaryLight, borderRadius: 8 },
  rateText:         { fontSize: 13, fontWeight: '700', color: COLORS.primary },
});
