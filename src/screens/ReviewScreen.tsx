import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, Pressable, TextInput,
  ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useReviewStore } from '../store/reviewStore';
import { useLibraryStore } from '../store/libraryStore';
import { toggleSavedItemPreview, stopPreview } from '../services/audio';
import { usePreviewStore } from '../store/previewStore';
import { playSavedItemPronunciation } from '../services/pronunciation';
import { getReviewStats, type ReviewStats } from '../db/queries/reviewLog';
import { shuffle, isDue, estimateMinutes } from '../utils/spacedRepetition';
import type { MasteryLevel, SavedItem, ReviewGrade } from '../types';

// ─── Mastery badge ────────────────────────────────────────────────────────────

const MASTERY_COLOR: Record<MasteryLevel, string> = {
  new:      COLORS.warning,
  learning: COLORS.primary,
  mastered: COLORS.success,
};

// ─── 4-grade rating bar (SM-2) ────────────────────────────────────────────────
// Used directly by the flashcard; the typed/multiple-choice modes derive a
// grade from correctness instead of showing this.

const GRADES: Array<{ grade: ReviewGrade; label: string; color: string }> = [
  { grade: 'again', label: '重来',   color: COLORS.error },
  { grade: 'hard',  label: '有点难', color: COLORS.warning },
  { grade: 'good',  label: '记得',   color: COLORS.primary },
  { grade: 'easy',  label: '很容易', color: COLORS.success },
];

function GradeBar({ onGrade }: { onGrade: (g: ReviewGrade) => void }) {
  return (
    <View style={styles.gradeRow}>
      {GRADES.map(g => (
        <Pressable
          key={g.grade}
          style={[styles.gradeBtn, { borderColor: g.color }]}
          onPress={() => onGrade(g.grade)}
        >
          <Text style={[styles.gradeText, { color: g.color }]}>{g.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Session summary ──────────────────────────────────────────────────────────

function SessionSummary({ onEnd }: { onEnd: () => void }) {
  const session = useReviewStore(s => s.session);
  if (!session) return null;
  const total = session.correctCount + session.incorrectCount;
  const pct   = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;

  return (
    <View style={styles.summaryCard}>
      <Ionicons name="trophy" size={48} color={COLORS.warning} />
      <Text style={styles.summaryTitle}>本轮完成!</Text>
      <Text style={styles.summaryScore}>{pct}%</Text>
      <Text style={styles.summarySubtitle}>记得 {session.correctCount} · 需加强 {session.incorrectCount}</Text>
      <Pressable style={styles.endBtn} onPress={onEnd}>
        <Text style={styles.endBtnText}>完成</Text>
      </Pressable>
    </View>
  );
}

// ─── Audio helpers ────────────────────────────────────────────────────────────
// Plays the ORIGINAL podcast audio sliced live from the source file (real
// native voice — best for memory). Bounds are corrected by text so the clip
// matches the displayed sentence even when stored timestamps are off.

function HearOriginalButton({ item }: { item: SavedItem }) {
  const key = `review-${item.id}`;
  const state = usePreviewStore(s => (s.activeKey === key ? s.status : 'idle'));
  useEffect(() => () => stopPreview(), []);
  const handlePlay = async () => {
    try { await toggleSavedItemPreview(key, item); } catch { /* best-effort */ }
  };
  return (
    <Pressable style={styles.clipBtn} onPress={handlePlay}>
      {state === 'loading'
        ? <ActivityIndicator size="small" color={COLORS.primary} />
        : <Ionicons name={state === 'playing' ? 'pause' : 'volume-high-outline'} size={16} color={COLORS.primary} />}
      <Text style={styles.clipBtnText}>{state === 'playing' ? '暂停' : '听原声'}</Text>
    </Pressable>
  );
}

// Reads the word/phrase via TTS (word pack for single words) — clear enunciation.
function SpeakWordButton({ item }: { item: SavedItem }) {
  return (
    <Pressable style={styles.clipBtn} onPress={() => playSavedItemPronunciation(`review-pron-${item.id}`, item)}>
      <Ionicons name="megaphone-outline" size={15} color={COLORS.primary} />
      <Text style={styles.clipBtnText}>读单词</Text>
    </Pressable>
  );
}

// ─── Flashcard mode (4-grade self-rating) ─────────────────────────────────────

function FlashcardMode({ item, onGrade, onSkip }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  // Reset reveal + stop any audio when the item changes
  useEffect(() => { setRevealed(false); return () => stopPreview(); }, [item.id]);

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />
        <Text style={styles.cardPhrase}>{item.text}</Text>
        <View style={styles.audioRow}>
          <HearOriginalButton item={item} />
          <SpeakWordButton item={item} />
        </View>

        {revealed ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.cardContext}>"{item.contextSentence}"</Text>
            {item.note && (
              <View style={styles.noteBlock}>
                <Ionicons name="bulb-outline" size={14} color={COLORS.warning} />
                <Text style={styles.noteText}>{item.note}</Text>
              </View>
            )}
            {item.enrichment && (
              <View style={styles.enrichBlock}>
                <Text style={styles.enrichZh}>{item.enrichment.translationZh}</Text>
                <Text style={styles.enrichDef}>{item.enrichment.definitionEn}</Text>
                {item.enrichment.synonyms.length > 0 && (
                  <Text style={styles.enrichSyn}>≈ {item.enrichment.synonyms.join(' · ')}</Text>
                )}
              </View>
            )}
            <Text style={styles.gradePrompt}>刚才回忆得怎么样?</Text>
            <GradeBar onGrade={onGrade} />
          </>
        ) : (
          <>
            <Text style={styles.recallHint}>先在心里回忆它的意思,再揭晓</Text>
            <Pressable style={styles.revealBtn} onPress={() => setRevealed(true)}>
              <Text style={styles.revealBtnText}>揭晓答案</Text>
            </Pressable>
            <Pressable style={styles.skipLink} onPress={onSkip}>
              <Text style={styles.skipLinkText}>跳过</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Fill-in-blank mode (typed production → graded) ───────────────────────────

function FillInBlankMode({ item, onGrade, onSkip }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void;
}) {
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);
  useEffect(() => { setAnswer(''); setChecked(false); }, [item.id]);

  const escaped = item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blankedCandidate = item.contextSentence.replace(
    new RegExp(escaped, 'i'),
    '_'.repeat(item.text.length)
  );
  const blanked = blankedCandidate === item.contextSentence
    ? '_'.repeat(item.text.length)
    : blankedCandidate;

  const isCorrect = answer.trim().toLowerCase() === item.text.trim().toLowerCase();

  const handleNext = () => onGrade(isCorrect ? 'good' : 'again');

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />
        <Text style={styles.modeTag}>拼出空缺的词</Text>
        <Text style={styles.blankSentence}>{blanked}</Text>

        <TextInput
          style={[
            styles.blankInput,
            checked && (isCorrect ? styles.inputCorrect : styles.inputIncorrect),
          ]}
          value={answer}
          onChangeText={setAnswer}
          placeholder="输入空缺的单词或短语…"
          placeholderTextColor={COLORS.textSecondary}
          editable={!checked}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={() => answer.trim() && setChecked(true)}
        />

        {checked && (
          <View style={styles.feedbackRow}>
            <Ionicons
              name={isCorrect ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={isCorrect ? COLORS.success : COLORS.error}
            />
            <Text style={[styles.feedbackText, { color: isCorrect ? COLORS.success : COLORS.error }]}>
              {isCorrect ? '正确!' : `答案: ${item.text}`}
            </Text>
          </View>
        )}

        <View style={styles.blankActions}>
          {!checked ? (
            <>
              <Pressable style={styles.skipBtn} onPress={onSkip}>
                <Text style={styles.skipBtnText}>跳过</Text>
              </Pressable>
              <Pressable style={styles.checkBtn} onPress={() => setChecked(true)} disabled={!answer.trim()}>
                <Text style={styles.checkBtnText}>检查</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.checkBtn} onPress={handleNext}>
              <Text style={styles.checkBtnText}>下一个 →</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Listen & Identify mode (multiple choice → graded) ────────────────────────

function ListenIdentifyMode({ item, onGrade, onSkip }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void;
}) {
  const allItems = useLibraryStore(s => s.items);
  const key = `li-${item.id}`;
  const state = usePreviewStore(s => (s.activeKey === key ? s.status : 'idle'));
  const [playError, setPlayError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  const choices = useMemo(() => {
    const distractors = shuffle(
      allItems
        .map(i => i.text)
        .filter((t, idx, arr) => arr.indexOf(t) === idx)
        .filter(t => t.toLowerCase() !== item.text.toLowerCase())
    ).slice(0, 3);
    return shuffle([item.text, ...distractors]);
  }, [item.id, allItems]);

  // Auto-play the original clip once when the card appears; stop on leave.
  useEffect(() => {
    setChosen(null);
    setPlayError(null);
    toggleSavedItemPreview(key, item).catch(e =>
      setPlayError(e instanceof Error ? e.message : 'Could not play clip'));
    return () => stopPreview();
  }, [item.id]);

  const isCorrect = chosen !== null && chosen === item.text;
  const handleNext = () => { stopPreview(); onGrade(isCorrect ? 'good' : 'again'); };

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />

        <Pressable style={styles.listenBtn} onPress={() => toggleSavedItemPreview(key, item).catch(() => {})}>
          {state === 'loading'
            ? <ActivityIndicator color="#fff" />
            : <Ionicons name={state === 'playing' ? 'pause' : 'volume-high'} size={32} color="#fff" />}
        </Pressable>
        <Text style={styles.listenHint}>点击重听这句话,再选出其中你学过的短语</Text>
        {playError && <Text style={styles.listenError}>{playError}</Text>}

        <View style={styles.choices}>
          {choices.map(choice => {
            const isAnswer = choice === item.text;
            const isThisChosen = chosen === choice;
            return (
              <Pressable
                key={choice}
                style={[
                  styles.choiceBtn,
                  chosen !== null && isAnswer && styles.choiceCorrect,
                  isThisChosen && !isAnswer && styles.choiceIncorrect,
                ]}
                onPress={() => chosen === null && setChosen(choice)}
                disabled={chosen !== null}
              >
                <Text style={styles.choiceText} numberOfLines={2}>{choice}</Text>
              </Pressable>
            );
          })}
        </View>

        {chosen === null ? (
          <View style={styles.blankActions}>
            <Pressable style={styles.skipBtn} onPress={() => { stopPreview(); onSkip(); }}>
              <Text style={styles.skipBtnText}>跳过</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.feedbackRow}>
              <Ionicons
                name={isCorrect ? 'checkmark-circle' : 'close-circle'}
                size={20}
                color={isCorrect ? COLORS.success : COLORS.error}
              />
              <Text style={[styles.feedbackText, { color: isCorrect ? COLORS.success : COLORS.error }]}>
                {isCorrect ? '正确!' : `正确答案: ${item.text}`}
              </Text>
            </View>
            <View style={styles.blankActions}>
              <Pressable style={styles.checkBtn} onPress={handleNext}>
                <Text style={styles.checkBtnText}>下一个 →</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

// ─── ReviewScreen ─────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const { session, isLoading, startSession, endSession, grade, skipItem } = useReviewStore();
  const items = useLibraryStore(s => s.items);
  const loadItems = useLibraryStore(s => s.loadItems);
  const [stats, setStats] = useState<ReviewStats | null>(null);

  const dueCount = items.filter(i => i.mastery !== 'mastered' && isDue(i.nextReview)).length;
  const masteryCounts = useMemo(() => ({
    new: items.filter(i => i.mastery === 'new').length,
    learning: items.filter(i => i.mastery === 'learning').length,
    mastered: items.filter(i => i.mastery === 'mastered').length,
  }), [items]);

  const isFinished = session !== null && session.currentIndex >= session.queue.length;
  const inSession  = session !== null && !isFinished;
  const progress   = session ? session.currentIndex / Math.max(1, session.queue.length) : 0;
  const card = inSession ? session!.queue[session!.currentIndex] : null;

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (!inSession) getReviewStats().then(setStats).catch(() => setStats(null));
  }, [inSession, isFinished]);

  // Start from due items; if nothing is due, fall back to a quick practice set
  // of the least-recently-scheduled non-mastered items.
  const handleStart = async (practiceAhead = false) => {
    await useLibraryStore.getState().loadItems();
    if (practiceAhead) {
      const pool = useLibraryStore.getState().items
        .filter(i => i.mastery !== 'mastered')
        .sort((a, b) => (a.nextReview ?? 0) - (b.nextReview ?? 0))
        .slice(0, 15);
      await startSession(pool);
    } else {
      await startSession();
    }
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      {inSession && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll}>
        {isFinished && <SessionSummary onEnd={endSession} />}

        {inSession && card && (
          <>
            <View style={styles.sessionHeader}>
              <Text style={styles.sessionCounter}>
                {session!.currentIndex + 1} / {session!.queue.length}
              </Text>
              <Pressable style={styles.endSessionBtn} onPress={endSession} hitSlop={6}>
                <Ionicons name="close" size={14} color={COLORS.textSecondary} />
                <Text style={styles.endSessionText}>结束</Text>
              </Pressable>
            </View>
            {card.mode === 'flashcard' && (
              <FlashcardMode key={card.item.id} item={card.item} onGrade={grade} onSkip={skipItem} />
            )}
            {card.mode === 'fill-in-blank' && (
              <FillInBlankMode key={card.item.id} item={card.item} onGrade={grade} onSkip={skipItem} />
            )}
            {card.mode === 'listen-identify' && (
              <ListenIdentifyMode key={card.item.id} item={card.item} onGrade={grade} onSkip={skipItem} />
            )}
          </>
        )}

        {/* Start screen — single smart-mixed entry */}
        {!session && (
          <>
            {stats && (stats.streakDays > 0 || stats.reviewedToday > 0) && (
              <View style={styles.streakBanner}>
                <Text style={styles.streakText}>🔥 连续 {stats.streakDays} 天</Text>
                <Text style={styles.streakSub}>今日已复习 {stats.reviewedToday}</Text>
              </View>
            )}

            {dueCount > 0 ? (
              <View style={styles.heroCard}>
                <Ionicons name="library" size={36} color={COLORS.primary} />
                <Text style={styles.heroTitle}>今日复习</Text>
                <Text style={styles.heroSub}>
                  {dueCount} 个词到期 · 约 {estimateMinutes(dueCount)} 分钟
                </Text>
                <Pressable
                  style={styles.startBtn}
                  onPress={() => handleStart(false)}
                  disabled={isLoading}
                >
                  {isLoading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.startBtnText}>开始复习</Text>}
                </Pressable>
                <Text style={styles.heroNote}>系统会自动混合翻卡、听音辨识、拼写填空</Text>
              </View>
            ) : (
              <View style={styles.heroCard}>
                <Ionicons name="checkmark-done-circle" size={40} color={COLORS.success} />
                <Text style={styles.heroTitle}>今天复习完了 ✓</Text>
                <Text style={styles.heroSub}>
                  {items.length === 0 ? '还没有保存任何短语 — 去转写里点选单词保存吧' : '到期的词都复习过了,记忆正在巩固'}
                </Text>
                {items.some(i => i.mastery !== 'mastered') && (
                  <Pressable style={styles.practiceBtn} onPress={() => handleStart(true)} disabled={isLoading}>
                    {isLoading
                      ? <ActivityIndicator color={COLORS.primary} />
                      : <Text style={styles.practiceBtnText}>提前练一些</Text>}
                  </Pressable>
                )}
              </View>
            )}

            {/* Mastery breakdown */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: COLORS.warning }]}>{masteryCounts.new}</Text>
                <Text style={styles.statLabel}>新词</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: COLORS.primary }]}>{masteryCounts.learning}</Text>
                <Text style={styles.statLabel}>学习中</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: COLORS.success }]}>{masteryCounts.mastered}</Text>
                <Text style={styles.statLabel}>已掌握</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:           { flex: 1, backgroundColor: COLORS.background },
  scroll:           { padding: 20, flexGrow: 1 },

  progressTrack:    { height: 3, backgroundColor: COLORS.border },
  progressFill:     { height: 3, backgroundColor: COLORS.primary },

  streakBanner:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.warning + '18', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16 },
  streakText:       { fontSize: 15, fontWeight: '700', color: COLORS.text },
  streakSub:        { fontSize: 13, color: COLORS.textSecondary },

  heroCard:         { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 20, padding: 28, marginBottom: 20 },
  heroTitle:        { fontSize: 22, fontWeight: '800', color: COLORS.text, marginTop: 12 },
  heroSub:          { fontSize: 14, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  heroNote:         { fontSize: 12, color: COLORS.textSecondary, marginTop: 12, textAlign: 'center' },

  startBtn:         { backgroundColor: COLORS.primary, borderRadius: 14, paddingHorizontal: 40, paddingVertical: 15, alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
  startBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  practiceBtn:      { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 18 },
  practiceBtnText:  { color: COLORS.primary, fontSize: 14, fontWeight: '700' },

  statsRow:         { flexDirection: 'row', gap: 12 },
  statCard:         { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center' },
  statNum:          { fontSize: 24, fontWeight: '800', color: COLORS.text },
  statLabel:        { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  sessionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sessionCounter:   { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  endSessionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  endSessionText:   { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },

  modeContainer:    { flex: 1 },
  card:             { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24 },
  masteryDot:       { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-end', marginBottom: 12 },
  modeTag:          { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600', marginBottom: 8 },
  cardPhrase:       { fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 16 },
  divider:          { height: 1, backgroundColor: COLORS.border, marginBottom: 16 },
  cardContext:      { fontSize: 15, color: COLORS.textSecondary, fontStyle: 'italic', lineHeight: 22, marginBottom: 16 },
  recallHint:       { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 12 },

  gradePrompt:      { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 10 },
  gradeRow:         { flexDirection: 'row', gap: 8 },
  gradeBtn:         { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  gradeText:        { fontSize: 13, fontWeight: '700' },

  revealBtn:        { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  revealBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipLink:         { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  skipLinkText:     { fontSize: 13, color: COLORS.textSecondary },

  blankSentence:    { fontSize: 18, color: COLORS.text, lineHeight: 28, marginBottom: 20, fontStyle: 'italic' },
  blankInput:       { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 15, color: COLORS.text, marginBottom: 12 },
  inputCorrect:     { borderColor: COLORS.success, backgroundColor: COLORS.success + '11' },
  inputIncorrect:   { borderColor: COLORS.error,   backgroundColor: COLORS.error   + '11' },
  feedbackRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  feedbackText:     { fontSize: 14, fontWeight: '600' },
  blankActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  skipBtn:          { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  skipBtnText:      { fontSize: 13, color: COLORS.textSecondary },
  checkBtn:         { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  checkBtnText:     { color: '#fff', fontWeight: '700', fontSize: 14 },

  clipBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: COLORS.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16 },
  clipBtnText:      { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  audioRow:         { flexDirection: 'row', gap: 8 },

  noteBlock:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warning + '14', borderRadius: 10, padding: 12, marginBottom: 12 },
  noteText:         { flex: 1, fontSize: 13, color: COLORS.text, lineHeight: 19 },

  enrichBlock:      { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, marginBottom: 16 },
  enrichZh:         { fontSize: 15, color: COLORS.text, fontWeight: '600', marginBottom: 4 },
  enrichDef:        { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  enrichSyn:        { fontSize: 13, color: COLORS.primary, marginTop: 6 },

  listenBtn:        { width: 72, height: 72, borderRadius: 36, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 12 },
  listenHint:       { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 16 },
  listenError:      { fontSize: 12, color: COLORS.error, textAlign: 'center', marginBottom: 12 },
  choices:          { gap: 8, marginBottom: 16 },
  choiceBtn:        { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, padding: 14, backgroundColor: COLORS.background },
  choiceCorrect:    { borderColor: COLORS.success, backgroundColor: COLORS.success + '11' },
  choiceIncorrect:  { borderColor: COLORS.error, backgroundColor: COLORS.error + '11' },
  choiceText:       { fontSize: 14, fontWeight: '600', color: COLORS.text },

  summaryCard:      { alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 20, padding: 32 },
  summaryTitle:     { fontSize: 22, fontWeight: '800', color: COLORS.text, marginTop: 16 },
  summaryScore:     { fontSize: 56, fontWeight: '900', color: COLORS.primary, marginVertical: 8 },
  summarySubtitle:  { fontSize: 14, color: COLORS.textSecondary, marginBottom: 24 },
  endBtn:           { backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12 },
  endBtnText:       { color: '#fff', fontWeight: '700' },
});
