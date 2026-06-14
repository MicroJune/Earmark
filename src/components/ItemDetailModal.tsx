import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView,
  ActivityIndicator, Alert, StyleSheet, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';
import type { SavedItem, MasteryLevel } from '../types';
import { useLibraryStore } from '../store/libraryStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { speak, speakSlowly, stopSpeaking } from '../services/tts';
import { toggleSavedItemPreview, stopPreview } from '../services/audio';
import { hasPronunciationAudio, playPronunciationText, playSavedItemPronunciation } from '../services/pronunciation';
import { usePreviewStore } from '../store/previewStore';
import { lookupWord, getWordForms, TAG_LABELS } from '../services/dictionary';
import { getHideMeaning } from '../services/settings';

const masteryColor = (c: Palette): Record<MasteryLevel, string> => ({
  new:      c.warning,
  learning: c.primary,
  mastered: c.success,
});

function SectionTitle({ children }: { children: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// Renders the context sentence with the saved phrase highlighted in place, so
// the user instantly sees WHERE the word sat in what they heard.
function HighlightedSentence({ sentence, phrase }: { sentence: string; phrase: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const lower = sentence.toLowerCase();
  const at = lower.indexOf(phrase.toLowerCase().trim());
  if (at < 0 || !phrase.trim()) {
    return <Text style={styles.context}>"{sentence}"</Text>;
  }
  const before = sentence.slice(0, at);
  const match = sentence.slice(at, at + phrase.trim().length);
  const after = sentence.slice(at + phrase.trim().length);
  return (
    <Text style={styles.context}>
      "{before}<Text style={styles.contextHighlight}>{match}</Text>{after}"
    </Text>
  );
}

export default function ItemDetailModal({
  item, onClose,
}: {
  item: SavedItem | null;
  onClose: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const MASTERY_COLOR = useMemo(() => masteryColor(c), [c]);
  const insets = useSafeAreaInsets();
  const enrichItem = useLibraryStore(s => s.enrichItem);
  const editItemText = useLibraryStore(s => s.editItemText);
  const setNote = useLibraryStore(s => s.setNote);
  const updateMastery = useLibraryStore(s => s.updateMastery);
  // Subscribe to the live item so the modal re-renders when enrichment lands
  const liveItem = useLibraryStore(s => s.items.find(i => i.id === item?.id));
  const audioFile = useAudioFilesStore(s =>
    s.audioFiles.find(f => f.id === item?.audioFileId)
  );
  const [enriching, setEnriching] = useState(false);
  const previewKey = `lib-${item?.id}`;
  const previewActive = usePreviewStore(s => s.activeKey === previewKey ? s.status : 'idle');
  // Edit mode — fix whisper transcription mistakes so they don't get drilled in
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editContext, setEditContext] = useState('');
  // Offline dictionary entry — instant, no API (single words only)
  const dictEntry = useMemo(
    () => (item ? lookupWord(item.text) : null),
    [item?.text]
  );
  const wordForms = useMemo(
    () => (item ? getWordForms(item.text) : []),
    [item?.text]
  );
  const hasStandardAudio = useMemo(
    () => (item ? hasPronunciationAudio(item.text) : false),
    [item?.text]
  );

  // Active recall: meaning is hidden until tapped (per the hide-meaning setting)
  const [revealed, setRevealed] = useState(false);
  // My note editing
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');

  // Reset per-item: re-hide the meaning and exit note editing when the item changes
  useEffect(() => {
    let active = true;
    getHideMeaning().then(hide => { if (active) setRevealed(!hide); });
    setEditingNote(false);
    return () => { active = false; };
  }, [item?.id]);

  if (!item) return null;
  const live = liveItem ?? item;
  const enrichment = live.enrichment;

  const handleHearOriginal = async () => {
    try {
      // Toggle: tap plays the clip, tap again pauses — never overlaps
      await toggleSavedItemPreview(previewKey, live);
    } catch (e) {
      Alert.alert('Playback failed', e instanceof Error ? e.message : 'Could not play the clip');
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
    stopPreview();
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

  const MASTERY_CYCLE: MasteryLevel[] = ['new', 'learning', 'mastered'];
  const cycleMastery = () => {
    const next = MASTERY_CYCLE[(MASTERY_CYCLE.indexOf(live.mastery) + 1) % MASTERY_CYCLE.length];
    void updateMastery(live.id, next);
  };

  const startEditingNote = () => {
    setNoteText(live.note ?? '');
    setEditingNote(true);
  };

  const handleSaveNote = async () => {
    try {
      await setNote(live.id, noteText);
      setEditingNote(false);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Could not save the note');
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      {/* Keep the header clear of the status bar — Android edge-to-edge
          renders Modal content underneath it otherwise */}
      <View style={[styles.modal, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
        <View style={styles.header}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>{live.type}</Text>
          </View>
          <Pressable
            style={[styles.masteryBadge, { backgroundColor: MASTERY_COLOR[live.mastery] + '22' }]}
            onPress={cycleMastery}
            hitSlop={6}
          >
            <Text style={[styles.masteryText, { color: MASTERY_COLOR[live.mastery] }]}>{live.mastery}</Text>
            <Ionicons name="swap-horizontal" size={12} color={MASTERY_COLOR[live.mastery]} />
          </Pressable>
          <View style={{ flex: 1 }} />
          {!editing && (
            <Pressable onPress={startEditing} hitSlop={8} style={{ marginRight: 14 }}>
              <Ionicons name="pencil" size={20} color={c.textSecondary} />
            </Pressable>
          )}
          <Pressable onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={c.text} />
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
            <Pressable style={styles.speakBtn} onPress={() => playSavedItemPronunciation(`pron-${live.id}`, live)}>
              <Ionicons name="volume-high" size={16} color="#fff" />
              <Text style={styles.speakBtnText}>Speak</Text>
            </Pressable>
            <Pressable style={styles.speakBtnOutline} onPress={() => speakSlowly(live.text)}>
              <Ionicons name="volume-low" size={16} color={c.primary} />
              <Text style={styles.speakBtnOutlineText}>Slow</Text>
            </Pressable>
            <Pressable style={styles.speakBtnOutline} onPress={handleHearOriginal}>
              {previewActive === 'loading'
                ? <ActivityIndicator size="small" color={c.primary} />
                : <Ionicons
                    name={previewActive === 'playing' ? 'pause' : 'musical-notes'}
                    size={16}
                    color={c.primary}
                  />}
              <Text style={styles.speakBtnOutlineText}>
                {previewActive === 'playing' ? 'Pause' : 'Original'}
              </Text>
            </Pressable>
          </View>

          {/* Phonetic + word forms + exam tags are visible cues (not "the answer") */}
          {dictEntry && (
            <>
              {dictEntry.phonetic ? (
                <Text style={styles.phonetic}>/{dictEntry.phonetic}/</Text>
              ) : null}
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
          {wordForms.length > 0 && (
            <>
              <SectionTitle>Word forms</SectionTitle>
              <View style={styles.formRow}>
                {wordForms.map(f => (
                  <Pressable key={f} style={styles.formChip} onPress={() => speak(f)}>
                    <Text style={styles.formText}>{f}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* Original context — phrase highlighted in place */}
          <SectionTitle>From the podcast</SectionTitle>
          <Pressable onPress={() => speak(live.contextSentence)}>
            <HighlightedSentence sentence={live.contextSentence} phrase={live.text} />
            {(audioFile?.title ?? live.sourceTitle) && (
              <Text style={styles.source}>
                {audioFile?.title ?? live.sourceTitle}
                {!audioFile && '  ·  source file deleted'}
              </Text>
            )}
          </Pressable>

          {/* Meaning — hidden until tapped, for active recall */}
          {!revealed ? (
            <Pressable style={styles.revealGate} onPress={() => setRevealed(true)}>
              <Ionicons name="eye-off-outline" size={18} color={c.primary} />
              <Text style={styles.revealGateText}>先回忆这个词的意思 — 点击揭晓</Text>
            </Pressable>
          ) : (
            <>
              {dictEntry && (
                <>
                  <SectionTitle>词典 (offline)</SectionTitle>
                  <Text style={styles.dictTranslation}>{dictEntry.translation}</Text>
                  <Text style={styles.pronunciationStatus}>
                    {hasStandardAudio ? 'Standard audio available' : 'Standard audio pack not installed — Speak uses TTS fallback'}
                  </Text>
                </>
              )}

              {/* Learning notes (AI) */}
              {enrichment && (
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
                          <Pressable key={s} style={styles.synonymChip} onPress={() => playPronunciationText(`syn-${live.id}-${s}`, s)}>
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
                            <Ionicons name="volume-medium-outline" size={14} color={c.primary} />
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
                        <Ionicons name="bulb-outline" size={16} color={c.warning} />
                        <Text style={styles.tipText}>{enrichment.tip}</Text>
                      </View>
                    </>
                  )}
                </>
              )}

              {/* My note — the user's own memory hook */}
              <SectionTitle>我的笔记</SectionTitle>
              {editingNote ? (
                <View>
                  <TextInput
                    style={[styles.editInput, { minHeight: 72 }]}
                    value={noteText}
                    onChangeText={setNoteText}
                    placeholder="写下你自己的联想、记忆方法或用法… (自己写的最难忘)"
                    placeholderTextColor={c.textSecondary}
                    multiline
                    autoFocus
                  />
                  <View style={styles.editActions}>
                    <Pressable style={styles.editCancelBtn} onPress={() => setEditingNote(false)}>
                      <Text style={styles.editCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable style={styles.editSaveBtn} onPress={handleSaveNote}>
                      <Text style={styles.editSaveText}>Save note</Text>
                    </Pressable>
                  </View>
                </View>
              ) : live.note ? (
                <Pressable style={styles.noteCard} onPress={startEditingNote}>
                  <Text style={styles.noteText}>{live.note}</Text>
                  <Ionicons name="pencil" size={14} color={c.textSecondary} />
                </Pressable>
              ) : (
                <Pressable style={styles.addNoteBtn} onPress={startEditingNote}>
                  <Ionicons name="add" size={16} color={c.primary} />
                  <Text style={styles.addNoteText}>添加我的记忆笔记</Text>
                </Pressable>
              )}
            </>
          )}

          {/* Generate-notes button stays visible regardless of reveal state */}
          {!enrichment && (
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

function makeStyles(c: Palette) {
  return StyleSheet.create({
  modal:        { flex: 1, padding: 24, backgroundColor: c.background },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },

  typeBadge:    { backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:{ fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  masteryBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  masteryText:  { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  itemText:     { fontSize: 26, fontWeight: '800', color: c.text, marginBottom: 14 },

  speakRow:     { flexDirection: 'row', gap: 10, marginBottom: 8 },
  speakBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  speakBtnOutline:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.primary, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  speakBtnOutlineText: { color: c.primary, fontSize: 13, fontWeight: '600' },

  sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },

  phonetic:        { fontSize: 14, color: c.textSecondary, marginBottom: 6 },
  pronunciationStatus: { fontSize: 12, color: c.textSecondary, marginBottom: 8 },
  dictTranslation: { fontSize: 14, color: c.text, lineHeight: 22 },
  tagRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tagChip:         { backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText:         { fontSize: 11, color: c.textSecondary, fontWeight: '600' },

  context:      { fontSize: 14, color: c.text, fontStyle: 'italic', lineHeight: 21 },
  contextHighlight: { fontStyle: 'italic', fontWeight: '800', color: c.primary, backgroundColor: c.primaryLight },
  source:       { fontSize: 11, color: c.textSecondary, marginTop: 4 },

  formRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formChip:     { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  formText:     { fontSize: 13, color: c.text },

  revealGate:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primaryLight, borderRadius: 12, paddingVertical: 18, marginTop: 20 },
  revealGateText: { fontSize: 14, fontWeight: '600', color: c.primary },

  noteCard:     { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.warning + '12', borderRadius: 10, padding: 12 },
  noteText:     { flex: 1, fontSize: 14, color: c.text, lineHeight: 21 },
  addNoteBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: c.primary, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  addNoteText:  { fontSize: 13, color: c.primary, fontWeight: '600' },

  translation:  { fontSize: 16, color: c.text, lineHeight: 24 },
  definition:   { fontSize: 14, color: c.text, lineHeight: 21 },

  synonymRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  synonymChip:  { backgroundColor: c.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  synonymText:  { fontSize: 13, color: c.primary, fontWeight: '600' },

  exampleCard:  { backgroundColor: c.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  exampleHeader:{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  exampleEn:    { flex: 1, fontSize: 14, color: c.text, lineHeight: 20 },
  exampleZh:    { fontSize: 13, color: c.textSecondary, marginTop: 4, lineHeight: 19 },

  tipCard:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.warning + '15', borderRadius: 10, padding: 12 },
  tipText:      { flex: 1, fontSize: 13, color: c.text, lineHeight: 19 },

  editBox:      { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 16 },
  editLabel:    { fontSize: 12, fontWeight: '700', color: c.textSecondary, marginBottom: 4, marginTop: 8 },
  editInput:    { borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 10, fontSize: 14, color: c.text, backgroundColor: c.background },
  editActions:  { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  editCancelBtn:{ paddingHorizontal: 14, paddingVertical: 8 },
  editCancelText:{ color: c.textSecondary, fontSize: 14 },
  editSaveBtn:  { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  editSaveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  editHint:     { fontSize: 11, color: c.textSecondary, marginTop: 8, lineHeight: 16 },

  enrichBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 12, padding: 14, marginTop: 24 },
  enrichBtnText:{ color: '#fff', fontSize: 14, fontWeight: '700' },
  enrichHint:   { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  });
}
