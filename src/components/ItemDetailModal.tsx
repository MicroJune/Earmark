import React, { useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView,
  ActivityIndicator, Alert, StyleSheet, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import type { SavedItem, MasteryLevel } from '../types';
import { useLibraryStore } from '../store/libraryStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { speak, speakSlowly, stopSpeaking } from '../services/tts';
import { playSavedItemAudio } from '../services/audio';
import { lookupWord, TAG_LABELS } from '../services/dictionary';

const MASTERY_COLOR: Record<MasteryLevel, string> = {
  new:      COLORS.warning,
  learning: COLORS.primary,
  mastered: COLORS.success,
};

function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export default function ItemDetailModal({
  item, onClose,
}: {
  item: SavedItem | null;
  onClose: () => void;
}) {
  const enrichItem = useLibraryStore(s => s.enrichItem);
  const editItemText = useLibraryStore(s => s.editItemText);
  // Subscribe to the live item so the modal re-renders when enrichment lands
  const liveItem = useLibraryStore(s => s.items.find(i => i.id === item?.id));
  const audioFile = useAudioFilesStore(s =>
    s.audioFiles.find(f => f.id === item?.audioFileId)
  );
  const [enriching, setEnriching] = useState(false);
  const [playingClip, setPlayingClip] = useState(false);
  // Edit mode — fix whisper transcription mistakes so they don't get drilled in
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editContext, setEditContext] = useState('');
  // Offline dictionary entry — instant, no API (single words only)
  const dictEntry = useMemo(
    () => (item ? lookupWord(item.text) : null),
    [item?.text]
  );

  if (!item) return null;
  const live = liveItem ?? item;
  const enrichment = live.enrichment;

  const handleHearOriginal = async () => {
    setPlayingClip(true);
    try {
      // Prefers the item's extracted clip; falls back to the source file
      await playSavedItemAudio(live);
    } catch (e) {
      Alert.alert('Playback failed', e instanceof Error ? e.message : 'Could not play the clip');
    } finally {
      setPlayingClip(false);
    }
  };

  const handleEnrich = async () => {
    setEnriching(true);
    try {
      await enrichItem(live.id);
    } catch (e) {
      Alert.alert('Could not generate notes', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setEnriching(false);
    }
  };

  const handleClose = () => {
    stopSpeaking();
    setEditing(false);
    onClose();
  };

  const startEditing = () => {
    setEditText(live.text);
    setEditContext(live.contextSentence);
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    const text = editText.trim();
    const context = editContext.trim();
    if (!text) {
      Alert.alert('Text required', 'The saved phrase cannot be empty.');
      return;
    }
    try {
      await editItemText(live.id, text, context || text);
      setEditing(false);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not update the item');
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{live.type}</Text>
          </View>
          <View style={[styles.masteryBadge, { backgroundColor: MASTERY_COLOR[live.mastery] + '22' }]}>
            <Text style={[styles.masteryText, { color: MASTERY_COLOR[live.mastery] }]}>{live.mastery}</Text>
          </View>
          <View style={{ flex: 1 }} />
          {!editing && (
            <Pressable onPress={startEditing} hitSlop={8} style={{ marginRight: 14 }}>
              <Ionicons name="pencil" size={20} color={COLORS.textSecondary} />
            </Pressable>
          )}
          <Pressable onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {editing && (
            <View style={styles.editBox}>
              <Text style={styles.editLabel}>Phrase</Text>
              <TextInput
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                autoCapitalize="none"
                multiline
              />
              <Text style={styles.editLabel}>Context sentence</Text>
              <TextInput
                style={[styles.editInput, { minHeight: 64 }]}
                value={editContext}
                onChangeText={setEditContext}
                autoCapitalize="none"
                multiline
              />
              <View style={styles.editActions}>
                <Pressable style={styles.editCancelBtn} onPress={() => setEditing(false)}>
                  <Text style={styles.editCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.editSaveBtn} onPress={handleSaveEdit}>
                  <Text style={styles.editSaveText}>Save changes</Text>
                </Pressable>
              </View>
              <Text style={styles.editHint}>
                修正 Whisper 听错的内容 — 修改后复习题目会用新文本。
              </Text>
            </View>
          )}

          {/* The saved text + pronunciation buttons */}
          <Text style={styles.itemText}>{live.text}</Text>

          <View style={styles.speakRow}>
            <Pressable style={styles.speakBtn} onPress={() => speak(live.text)}>
              <Ionicons name="volume-high" size={16} color="#fff" />
              <Text style={styles.speakBtnText}>Speak</Text>
            </Pressable>
            <Pressable style={styles.speakBtnOutline} onPress={() => speakSlowly(live.text)}>
              <Ionicons name="volume-low" size={16} color={COLORS.primary} />
              <Text style={styles.speakBtnOutlineText}>Slow</Text>
            </Pressable>
            <Pressable style={styles.speakBtnOutline} onPress={handleHearOriginal} disabled={playingClip}>
              {playingClip
                ? <ActivityIndicator size="small" color={COLORS.primary} />
                : <Ionicons name="musical-notes" size={16} color={COLORS.primary} />}
              <Text style={styles.speakBtnOutlineText}>Original</Text>
            </Pressable>
          </View>

          {/* Offline dictionary (single words) */}
          {dictEntry && (
            <>
              <SectionTitle>词典 (offline)</SectionTitle>
              {dictEntry.phonetic ? (
                <Text style={styles.phonetic}>/{dictEntry.phonetic}/</Text>
              ) : null}
              <Text style={styles.dictTranslation}>{dictEntry.translation}</Text>
              {dictEntry.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {dictEntry.tags.map(t => (
                    <View key={t} style={styles.tagChip}>
                      <Text style={styles.tagText}>{TAG_LABELS[t] ?? t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          {/* Original context */}
          <SectionTitle>From the podcast</SectionTitle>
          <Pressable onPress={() => speak(live.contextSentence)}>
            <Text style={styles.context}>"{live.contextSentence}"</Text>
            {(audioFile?.title ?? live.sourceTitle) && (
              <Text style={styles.source}>
                {audioFile?.title ?? live.sourceTitle}
                {!audioFile && '  ·  source file deleted'}
              </Text>
            )}
          </Pressable>

          {/* Learning notes */}
          {enrichment ? (
            <>
              <SectionTitle>中文翻译</SectionTitle>
              <Text style={styles.translation}>{enrichment.translationZh}</Text>

              <SectionTitle>English definition</SectionTitle>
              <Text style={styles.definition}>{enrichment.definitionEn}</Text>

              {enrichment.synonyms.length > 0 && (
                <>
                  <SectionTitle>Similar words & phrases</SectionTitle>
                  <View style={styles.synonymRow}>
                    {enrichment.synonyms.map(s => (
                      <Pressable key={s} style={styles.synonymChip} onPress={() => speak(s)}>
                        <Text style={styles.synonymText}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {enrichment.examples.length > 0 && (
                <>
                  <SectionTitle>More examples</SectionTitle>
                  {enrichment.examples.map((ex, i) => (
                    <Pressable key={i} style={styles.exampleCard} onPress={() => speak(ex.en)}>
                      <View style={styles.exampleHeader}>
                        <Ionicons name="volume-medium-outline" size={14} color={COLORS.primary} />
                        <Text style={styles.exampleEn}>{ex.en}</Text>
                      </View>
                      <Text style={styles.exampleZh}>{ex.zh}</Text>
                    </Pressable>
                  ))}
                </>
              )}

              {enrichment.tip && (
                <>
                  <SectionTitle>Tip</SectionTitle>
                  <View style={styles.tipCard}>
                    <Ionicons name="bulb-outline" size={16} color={COLORS.warning} />
                    <Text style={styles.tipText}>{enrichment.tip}</Text>
                  </View>
                </>
              )}
            </>
          ) : (
            <Pressable style={styles.enrichBtn} onPress={handleEnrich} disabled={enriching}>
              {enriching
                ? <ActivityIndicator color="#fff" />
                : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#fff" />
                    <Text style={styles.enrichBtnText}>Generate learning notes (AI)</Text>
                  </>
                )}
            </Pressable>
          )}

          {!enrichment && (
            <Text style={styles.enrichHint}>
              翻译、近义词、例句和用法提示 — 生成一次后永久保存，离线可看。
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal:        { flex: 1, padding: 24, backgroundColor: COLORS.background },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },

  typeBadge:    { backgroundColor: COLORS.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:{ fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  masteryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  masteryText:  { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  itemText:     { fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 14 },

  speakRow:     { flexDirection: 'row', gap: 10, marginBottom: 8 },
  speakBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  speakBtnOutline:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakBtnOutlineText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },

  sectionTitle: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },

  phonetic:        { fontSize: 14, color: COLORS.textSecondary, marginBottom: 6 },
  dictTranslation: { fontSize: 14, color: COLORS.text, lineHeight: 22 },
  tagRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tagChip:         { backgroundColor: COLORS.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText:         { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },

  context:      { fontSize: 14, color: COLORS.text, fontStyle: 'italic', lineHeight: 21 },
  source:       { fontSize: 11, color: COLORS.textSecondary, marginTop: 4 },

  translation:  { fontSize: 16, color: COLORS.text, lineHeight: 24 },
  definition:   { fontSize: 14, color: COLORS.text, lineHeight: 21 },

  synonymRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  synonymChip:  { backgroundColor: COLORS.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  synonymText:  { fontSize: 13, color: COLORS.primary, fontWeight: '600' },

  exampleCard:  { backgroundColor: COLORS.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  exampleHeader:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  exampleEn:    { flex: 1, fontSize: 14, color: COLORS.text, lineHeight: 20 },
  exampleZh:    { fontSize: 13, color: COLORS.textSecondary, marginTop: 4, lineHeight: 19 },

  tipCard:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warning + '15', borderRadius: 10, padding: 12 },
  tipText:      { flex: 1, fontSize: 13, color: COLORS.text, lineHeight: 19 },

  editBox:      { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 16 },
  editLabel:    { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 4, marginTop: 8 },
  editInput:    { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.background },
  editActions:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  editCancelBtn:{ paddingHorizontal: 14, paddingVertical: 8 },
  editCancelText:{ color: COLORS.textSecondary, fontSize: 14 },
  editSaveBtn:  { backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  editSaveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  editHint:     { fontSize: 11, color: COLORS.textSecondary, marginTop: 8, lineHeight: 16 },

  enrichBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, marginTop: 24 },
  enrichBtnText:{ color: '#fff', fontSize: 14, fontWeight: '700' },
  enrichHint:   { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 18 },
});
