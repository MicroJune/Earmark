import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, Modal, Pressable, FlatList,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';
import type { PhraseSuggestion, SavedItemType, Segment } from '../types';
import { getPhraseSuggestions, fetchMoreSuggestions } from '../services/suggestions';
import { getSuggestionDensity, setSuggestionDensity, type SuggestionDensity } from '../services/settings';
import { getSegmentsByAudioFile } from '../db/queries/segments';
import { useLibraryStore } from '../store/libraryStore';
import { seekTo } from '../services/audio';
import { formatDuration } from '../utils/timeFormat';
import ScrollIndicator, { type ScrollIndicatorHandle } from './ScrollIndicator';

const DENSITY_OPTIONS: Array<{ value: SuggestionDensity; label: string }> = [
  { value: 'low', label: '低 · 2/分钟' },
  { value: 'medium', label: '中 · 8/分钟' },
  { value: 'high', label: '高 · 14/分钟' },
];

// ─── AI phrase suggestions overlay ────────────────────────────────────────────
// Lists AI-suggested phrases for the current file. Each can be saved to the
// library with one tap; tapping the timestamp jumps playback to that moment.

function inferType(text: string): SavedItemType {
  const count = text.trim().split(/\s+/).length;
  if (count === 1) return 'word';
  if (count >= 6) return 'sentence';
  return 'phrase';
}

function SuggestionCard({
  suggestion, saved, onToggleSave, onJump,
}: {
  suggestion: PhraseSuggestion;
  saved: boolean;
  onToggleSave: () => void;
  onJump: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.phrase}>{suggestion.text}</Text>
        {/* Tappable both ways: tap to save, tap again to undo (un-save). */}
        <Pressable
          style={[styles.saveBtn, saved && styles.savedBtn]}
          onPress={onToggleSave}
        >
          <Ionicons name={saved ? 'checkmark' : 'bookmark-outline'} size={14} color={saved ? c.success : '#fff'} />
          <Text style={[styles.saveBtnText, saved && styles.savedBtnText]}>{saved ? '已保存' : 'Save'}</Text>
        </Pressable>
      </View>
      <Text style={styles.reason}>{suggestion.reason}</Text>
      <Text style={styles.context} numberOfLines={2}>"{suggestion.contextSentence}"</Text>
      <Pressable style={styles.jumpBtn} onPress={onJump} hitSlop={6}>
        <Ionicons name="play-circle-outline" size={14} color={c.primary} />
        <Text style={styles.jumpText}>{formatDuration(suggestion.startTime)}</Text>
      </Pressable>
    </View>
  );
}

export default function SuggestionsModal({
  visible, onClose, audioFileId,
}: {
  visible: boolean;
  onClose: () => void;
  audioFileId: number;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const scrollIndicatorRef = useRef<ScrollIndicatorHandle>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PhraseSuggestion[]>([]);
  const [savedTexts, setSavedTexts] = useState<Set<string>>(new Set());
  const [segments, setSegments] = useState<Segment[]>([]);
  const [density, setDensity] = useState<SuggestionDensity>('medium');
  const [noMoreFound, setNoMoreFound] = useState(false);

  const libraryItems = useLibraryStore(s => s.items);
  const addItem = useLibraryStore(s => s.addItem);
  const removeItem = useLibraryStore(s => s.removeItem);

  // Phrases the user already saved for this file — shown as "Saved" and
  // excluded when asking the AI for more.
  const librarySavedTexts = useCallback(() =>
    libraryItems
      .filter(i => i.audioFileId === audioFileId)
      .map(i => i.text),
  [libraryItems, audioFileId]);

  const markSaved = useCallback((result: PhraseSuggestion[]) => {
    const existing = new Set(librarySavedTexts().map(t => t.toLowerCase()));
    setSavedTexts(new Set(result.filter(s => existing.has(s.text.toLowerCase())).map(s => s.text)));
  }, [librarySavedTexts]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNoMoreFound(false);
    try {
      const segs = await getSegmentsByAudioFile(audioFileId);
      setSegments(segs);
      // Provider + key resolution + clear errors happen inside getPhraseSuggestions → ai.ts
      const result = await getPhraseSuggestions(audioFileId, segs);
      setSuggestions(result);
      markSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get suggestions');
    } finally {
      setLoading(false);
    }
  }, [audioFileId, markSaved]);

  // "Find more": fetch another batch excluding everything already shown/saved.
  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setError(null);
    try {
      const before = suggestions.length;
      const combined = await fetchMoreSuggestions(audioFileId, segments, librarySavedTexts());
      setSuggestions(combined);
      markSaved(combined);
      setNoMoreFound(combined.length === before);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get suggestions');
    } finally {
      setLoadingMore(false);
    }
  }, [audioFileId, segments, suggestions.length, librarySavedTexts, markSaved]);

  useEffect(() => {
    if (visible) {
      void getSuggestionDensity().then(setDensity);
      void load();
    } else {
      setSuggestions([]); setError(null); setNoMoreFound(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleDensity = (d: SuggestionDensity) => {
    setDensity(d);
    void setSuggestionDensity(d);
  };

  const handleToggleSave = async (s: PhraseSuggestion) => {
    // Already saved → undo the save by removing the matching library item.
    if (savedTexts.has(s.text)) {
      const match = libraryItems.find(
        i => i.audioFileId === audioFileId && i.text.toLowerCase() === s.text.toLowerCase()
      );
      try {
        if (match) await removeItem(match);
        setSavedTexts(prev => { const next = new Set(prev); next.delete(s.text); return next; });
      } catch {
        // removeItem surfaces its own DB errors via store error state
      }
      return;
    }
    try {
      await addItem({
        audioFileId,
        text: s.text,
        contextSentence: s.contextSentence,
        startTime: s.startTime,
        endTime: s.endTime,
        type: inferType(s.text),
        mastery: 'new',
      });
      setSavedTexts(prev => new Set(prev).add(s.text));
    } catch {
      // addItem surfaces its own DB errors via store error state
    }
  };

  const handleJump = (s: PhraseSuggestion) => {
    void seekTo(s.startTime);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Keep the header clear of the status bar (Android edge-to-edge) */}
      <View style={[styles.modal, { paddingTop: Math.max(insets.top, 12) }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="sparkles" size={18} color={c.primary} />
            <Text style={styles.title}>Suggested phrases</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={c.text} />
            </Pressable>
          </View>
        </View>

        {/* 建议密度:作用于下一次生成/找更多 */}
        <View style={styles.densityRow}>
          <Text style={styles.densityLabel}>密度</Text>
          {DENSITY_OPTIONS.map(o => (
            <Pressable
              key={o.value}
              style={[styles.densityChip, density === o.value && styles.densityChipActive]}
              onPress={() => handleDensity(o.value)}
            >
              <Text style={[styles.densityChipText, density === o.value && styles.densityChipTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={styles.loadingText}>AI 正在通读全文,挑选值得学的短语…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={48} color={c.border} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && (
          <View style={styles.listWrap}>
          <FlatList
            data={suggestions}
            keyExtractor={(s, i) => `${i}-${s.text}`}
            renderItem={({ item }) => (
              <SuggestionCard
                suggestion={item}
                saved={savedTexts.has(item.text)}
                onToggleSave={() => handleToggleSave(item)}
                onJump={() => handleJump(item)}
              />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={e => scrollIndicatorRef.current?.onScroll(e)}
            ListFooterComponent={
              suggestions.length > 0 ? (
                <View style={styles.footer}>
                  {noMoreFound && (
                    <Text style={styles.noMoreText}>这一集里没有找到更多新短语了</Text>
                  )}
                  <Pressable style={styles.moreBtn} onPress={loadMore} disabled={loadingMore}>
                    {loadingMore
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="sparkles" size={15} color="#fff" />}
                    <Text style={styles.moreBtnText}>
                      {loadingMore ? '正在找更多…' : '找更多短语(不会重复)'}
                    </Text>
                  </Pressable>
                  <Text style={styles.footerCount}>已建议 {suggestions.length} 条</Text>
                </View>
              ) : null
            }
          />
          <ScrollIndicator ref={scrollIndicatorRef} />
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Palette) {
  return StyleSheet.create({
  modal:        { flex: 1, backgroundColor: c.background },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 12 },
  headerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerActions:{ flexDirection: 'row', alignItems: 'center', gap: 16 },
  title:        { fontSize: 18, fontWeight: '700', color: c.text },

  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText:  { marginTop: 16, fontSize: 14, color: c.textSecondary, textAlign: 'center' },
  errorText:    { marginTop: 16, fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 21 },

  listWrap:     { flex: 1 },
  list:         { padding: 16, paddingTop: 4 },
  card:         { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  phrase:       { fontSize: 16, fontWeight: '700', color: c.text, flex: 1 },
  reason:       { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 6 },
  context:      { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', lineHeight: 19, marginBottom: 8 },

  saveBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  saveBtnText:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  savedBtn:     { backgroundColor: c.success + '22' },
  savedBtnText: { color: c.success },

  jumpBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  jumpText:     { fontSize: 12, color: c.primary, fontWeight: '600' },

  densityRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingBottom: 10 },
  densityLabel:     { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginRight: 2 },
  densityChip:      { borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  densityChipActive:{ borderColor: c.primary, backgroundColor: c.primaryLight },
  densityChipText:  { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  densityChipTextActive: { color: c.primary },

  footer:       { alignItems: 'center', paddingVertical: 16, gap: 8 },
  noMoreText:   { fontSize: 12, color: c.textSecondary },
  moreBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  moreBtnText:  { color: '#fff', fontSize: 13, fontWeight: '700' },
  footerCount:  { fontSize: 11, color: c.textSecondary },
  });
}
