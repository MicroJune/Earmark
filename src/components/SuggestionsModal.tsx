import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, FlatList,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import type { PhraseSuggestion, SavedItemType } from '../types';
import { getPhraseSuggestions, clearPhraseSuggestions } from '../services/claude';
import { getApiKeys } from '../services/config';
import { getSegmentsByAudioFile } from '../db/queries/segments';
import { useLibraryStore } from '../store/libraryStore';
import { seekTo } from '../services/audio';
import { formatDuration } from '../utils/timeFormat';

// ─── AI phrase suggestions overlay ────────────────────────────────────────────
// Lists Claude-suggested phrases for the current file. Each can be saved to the
// library with one tap; tapping the timestamp jumps playback to that moment.

function inferType(text: string): SavedItemType {
  const count = text.trim().split(/\s+/).length;
  if (count === 1) return 'word';
  if (count >= 6) return 'sentence';
  return 'phrase';
}

function SuggestionCard({
  suggestion, saved, onSave, onJump,
}: {
  suggestion: PhraseSuggestion;
  saved: boolean;
  onSave: () => void;
  onJump: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.phrase}>{suggestion.text}</Text>
        <Pressable
          style={[styles.saveBtn, saved && styles.savedBtn]}
          onPress={onSave}
          disabled={saved}
        >
          <Ionicons name={saved ? 'checkmark' : 'bookmark-outline'} size={14} color={saved ? COLORS.success : '#fff'} />
          <Text style={[styles.saveBtnText, saved && styles.savedBtnText]}>{saved ? 'Saved' : 'Save'}</Text>
        </Pressable>
      </View>
      <Text style={styles.reason}>{suggestion.reason}</Text>
      <Text style={styles.context} numberOfLines={2}>"{suggestion.contextSentence}"</Text>
      <Pressable style={styles.jumpBtn} onPress={onJump} hitSlop={6}>
        <Ionicons name="play-circle-outline" size={14} color={COLORS.primary} />
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PhraseSuggestion[]>([]);
  const [savedTexts, setSavedTexts] = useState<Set<string>>(new Set());

  const libraryItems = useLibraryStore(s => s.items);
  const addItem = useLibraryStore(s => s.addItem);

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const keys = await getApiKeys();
      if (!keys?.anthropicApiKey) {
        setError(
          'AI suggestions need an Anthropic API key and an internet connection. ' +
          'Add a key in Settings on the Home screen. Everything else in the app works offline.'
        );
        return;
      }
      if (forceRefresh) await clearPhraseSuggestions(audioFileId);
      const segments = await getSegmentsByAudioFile(audioFileId);
      const result = await getPhraseSuggestions(audioFileId, segments, keys.anthropicApiKey);
      setSuggestions(result);

      // Mark phrases that are already in the library as saved
      const existing = new Set(
        libraryItems
          .filter(i => i.audioFileId === audioFileId)
          .map(i => i.text.toLowerCase())
      );
      setSavedTexts(new Set(result.filter(s => existing.has(s.text.toLowerCase())).map(s => s.text)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get suggestions');
    } finally {
      setLoading(false);
    }
  }, [audioFileId, libraryItems]);

  useEffect(() => {
    if (visible) void load();
    else { setSuggestions([]); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSave = async (s: PhraseSuggestion) => {
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
      <View style={styles.modal}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="sparkles" size={18} color={COLORS.primary} />
            <Text style={styles.title}>Suggested phrases</Text>
          </View>
          <View style={styles.headerActions}>
            {!loading && suggestions.length > 0 && (
              <Pressable onPress={() => load(true)} hitSlop={8}>
                <Ionicons name="refresh" size={20} color={COLORS.textSecondary} />
              </Pressable>
            )}
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </Pressable>
          </View>
        </View>

        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Asking Claude for phrases worth learning…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={48} color={COLORS.border} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {!loading && !error && (
          <FlatList
            data={suggestions}
            keyExtractor={(s, i) => `${i}-${s.text}`}
            renderItem={({ item }) => (
              <SuggestionCard
                suggestion={item}
                saved={savedTexts.has(item.text)}
                onSave={() => handleSave(item)}
                onJump={() => handleJump(item)}
              />
            )}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modal:        { flex: 1, backgroundColor: COLORS.background },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 12 },
  headerLeft:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerActions:{ flexDirection: 'row', alignItems: 'center', gap: 16 },
  title:        { fontSize: 18, fontWeight: '700', color: COLORS.text },

  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText:  { marginTop: 16, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' },
  errorText:    { marginTop: 16, fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 21 },

  list:         { padding: 16, paddingTop: 4 },
  card:         { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  phrase:       { fontSize: 16, fontWeight: '700', color: COLORS.text, flex: 1 },
  reason:       { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 6 },
  context:      { fontSize: 13, color: COLORS.textSecondary, fontStyle: 'italic', lineHeight: 19, marginBottom: 8 },

  saveBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  saveBtnText:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  savedBtn:     { backgroundColor: COLORS.success + '22' },
  savedBtnText: { color: COLORS.success },

  jumpBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  jumpText:     { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
});
