import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, Pressable, TextInput,
  ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../constants/colors';
import { useTheme } from '../theme/ThemeProvider';
import { useReviewStore } from '../store/reviewStore';
import { useLibraryStore } from '../store/libraryStore';
import { toggleSavedItemPreview, stopPreview } from '../services/audio';
import { usePreviewStore } from '../store/previewStore';
import { playSavedItemPronunciation } from '../services/pronunciation';
import { getReviewStats, type ReviewStats } from '../db/queries/reviewLog';
import { shuffle, isDue, estimateMinutes, matchAnswer } from '../utils/spacedRepetition';
import { normalizeText } from '../utils/text';
import type { MasteryLevel, SavedItem, ReviewGrade } from '../types';

// ─── Mastery badge ────────────────────────────────────────────────────────────

const makeMasteryColor = (c: Palette): Record<MasteryLevel, string> => ({
  new:      c.warning,
  learning: c.primary,
  mastered: c.success,
});

// ─── 4-grade rating bar (SM-2) ────────────────────────────────────────────────
// Used directly by the flashcard; the typed/multiple-choice modes derive a
// grade from correctness instead of showing this.

const makeGrades = (c: Palette): Array<{ grade: ReviewGrade; label: string; color: string }> => [
  { grade: 'again', label: '重来',   color: c.error },
  { grade: 'hard',  label: '有点难', color: c.warning },
  { grade: 'good',  label: '记得',   color: c.primary },
  { grade: 'easy',  label: '很容易', color: c.success },
];

function GradeBar({ onGrade }: { onGrade: (g: ReviewGrade) => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const GRADES = useMemo(() => makeGrades(c), [c]);
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const session = useReviewStore(s => s.session);
  if (!session) return null;
  const total = session.correctCount + session.incorrectCount;
  const pct   = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;

  return (
    <View style={styles.summaryCard}>
      <Ionicons name="trophy" size={48} color={c.warning} />
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const key = `review-${item.id}`;
  const state = usePreviewStore(s => (s.activeKey === key ? s.status : 'idle'));
  useEffect(() => () => stopPreview(), []);
  const handlePlay = async () => {
    try { await toggleSavedItemPreview(key, item); } catch { /* best-effort */ }
  };
  return (
    <Pressable style={styles.clipBtn} onPress={handlePlay}>
      {state === 'loading'
        ? <ActivityIndicator size="small" color={c.primary} />
        : <Ionicons name={state === 'playing' ? 'pause' : 'volume-high-outline'} size={16} color={c.primary} />}
      <Text style={styles.clipBtnText}>{state === 'playing' ? '暂停' : '听原声'}</Text>
    </Pressable>
  );
}

// Reads the word/phrase via TTS (word pack for single words) — clear enunciation.
function SpeakWordButton({ item }: { item: SavedItem }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={styles.clipBtn} onPress={() => playSavedItemPronunciation(`review-pron-${item.id}`, item)}>
      <Ionicons name="megaphone-outline" size={15} color={c.primary} />
      <Text style={styles.clipBtnText}>读单词</Text>
    </Pressable>
  );
}

// ─── Relearn badge ────────────────────────────────────────────────────────────
// Shown when a card was answered "重来" earlier this session and requeued.

function RelearnBadge({ show }: { show?: boolean }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (!show) return null;
  return (
    <View style={styles.relearnBadge}>
      <Ionicons name="refresh" size={12} color={c.warning} />
      <Text style={styles.relearnText}>再练一次</Text>
    </View>
  );
}

// ─── Flashcard mode (listening-first recall, 4-grade self-rating) ─────────────
// Goal: "hear it → instantly grasp the meaning." The original clip auto-plays
// when the card appears; the learner recalls the Chinese meaning before
// revealing. The reveal leads with the meaning, not the English text.

function FlashcardMode({ item, onGrade, onSkip, isRelearn }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void; isRelearn?: boolean;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
  const [revealed, setRevealed] = useState(false);
  // Reset reveal and auto-play the original clip when the item changes.
  useEffect(() => {
    setRevealed(false);
    toggleSavedItemPreview(`review-${item.id}`, item).catch(() => {});
    return () => stopPreview();
  }, [item.id]);

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <RelearnBadge show={isRelearn} />
          <View style={[styles.masteryDot, { backgroundColor: masteryColor[item.mastery] }]} />
        </View>
        <Text style={styles.cardPhrase}>{item.text}</Text>
        <View style={styles.audioRow}>
          <HearOriginalButton item={item} />
          <SpeakWordButton item={item} />
        </View>

        {revealed ? (
          <>
            <View style={styles.divider} />
            {item.enrichment?.translationZh
              ? <Text style={styles.meaningZh}>{item.enrichment.translationZh}</Text>
              : <Text style={styles.meaningMissing}>这条还没有中文释义 — 可在词条详情里补充</Text>}
            <Text style={styles.cardContext}>"{item.contextSentence}"</Text>
            {item.note && (
              <View style={styles.noteBlock}>
                <Ionicons name="bulb-outline" size={14} color={c.warning} />
                <Text style={styles.noteText}>{item.note}</Text>
              </View>
            )}
            {item.enrichment && (
              <View style={styles.enrichBlock}>
                <Text style={styles.enrichDef}>{item.enrichment.definitionEn}</Text>
                {item.enrichment.synonyms.length > 0 && (
                  <Text style={styles.enrichSyn}>≈ {item.enrichment.synonyms.join(' · ')}</Text>
                )}
              </View>
            )}
            <Text style={styles.gradePrompt}>刚才听懂 / 想起意思了吗?</Text>
            <GradeBar onGrade={onGrade} />
          </>
        ) : (
          <>
            <Text style={styles.recallHint}>先听原声,在心里回忆它的中文意思,再揭晓</Text>
            <Pressable style={styles.revealBtn} onPress={() => setRevealed(true)}>
              <Text style={styles.revealBtnText}>揭晓意思</Text>
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

function FillInBlankMode({ item, onGrade, onSkip, isRelearn }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void; isRelearn?: boolean;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
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

  // Fuzzy match so a stray comma / capital / single typo isn't a hard fail.
  const match = matchAnswer(answer, item.text);
  const isCorrect = match === 'exact' || match === 'close';

  // exact → good · close (typo) → hard · wrong → again
  const handleNext = () =>
    onGrade(match === 'exact' ? 'good' : match === 'close' ? 'hard' : 'again');

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={styles.cardTopRow}>
          <RelearnBadge show={isRelearn} />
          <View style={[styles.masteryDot, { backgroundColor: masteryColor[item.mastery] }]} />
        </View>
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
          placeholderTextColor={c.textSecondary}
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
              color={isCorrect ? c.success : c.error}
            />
            <Text style={[styles.feedbackText, { color: isCorrect ? c.success : c.error }]}>
              {match === 'exact' ? '正确!'
                : match === 'close' ? `差一点 — 正确写法: ${item.text}`
                : `答案: ${item.text}`}
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

function ListenIdentifyMode({ item, onGrade, onSkip, isRelearn }: {
  item: SavedItem; onGrade: (g: ReviewGrade) => void; onSkip: () => void; isRelearn?: boolean;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
  const allItems = useLibraryStore(s => s.items);
  const key = `li-${item.id}`;
  const state = usePreviewStore(s => (s.activeKey === key ? s.status : 'idle'));
  const [playError, setPlayError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Distractors should resemble the answer (same type, similar length/word
  // count) so the choice is a real discrimination, not a giveaway. We fall back
  // to any other items if there aren't enough similar ones.
  const choices = useMemo(() => {
    // Compare by normalized text (lowercase, no punctuation, single spaces) so a
    // near-duplicate of the answer — e.g. "Im coming down with the flu" vs
    // "I'm coming down with the flu" (Whisper apostrophe variance) — is never
    // offered as a distractor, and two such variants don't both appear.
    const seen = new Set<string>([normalizeText(item.text)]);
    const others = allItems.filter(it => {
      const key = normalizeText(it.text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const wordCount = (t: string) => t.trim().split(/\s+/).length;
    const targetWords = wordCount(item.text);
    const similar = others.filter(
      it => it.type === item.type && Math.abs(wordCount(it.text) - targetWords) <= 1
    );
    const pool = similar.length >= 3 ? similar : others;
    const distractors = shuffle(pool.map(i => i.text)).slice(0, 3);
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
        <View style={styles.cardTopRow}>
          <RelearnBadge show={isRelearn} />
          <View style={[styles.masteryDot, { backgroundColor: masteryColor[item.mastery] }]} />
        </View>

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
                color={isCorrect ? c.success : c.error}
              />
              <Text style={[styles.feedbackText, { color: isCorrect ? c.success : c.error }]}>
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { session, isLoading, startSession, endSession, grade, skipItem, demoteCurrent } = useReviewStore();
  const items = useLibraryStore(s => s.items);
  const loadItems = useLibraryStore(s => s.loadItems);
  const [stats, setStats] = useState<ReviewStats | null>(null);

  const dueCount = items.filter(i => i.mastery !== 'mastered' && isDue(i.nextReview)).length;
  // Counts of items mastered within each recent window (cumulative).
  const DAY_MS = 24 * 60 * 60 * 1000;
  const recentMasteredCount = (days: number) => {
    const since = Date.now() - days * DAY_MS;
    return items.filter(i => i.mastery === 'mastered' && i.masteredAt != null && i.masteredAt >= since).length;
  };
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

  // Recall check over items mastered within the last `days` days — a random
  // sample (capped) so a big backlog stays a quick check, not a marathon.
  const handleStartRecent = async (days: number) => {
    await useLibraryStore.getState().loadItems();
    const since = Date.now() - days * DAY_MS;
    const pool = useLibraryStore.getState().items.filter(
      i => i.mastery === 'mastered' && i.masteredAt != null && i.masteredAt >= since
    );
    if (pool.length === 0) return;
    await startSession(shuffle(pool).slice(0, 20), 'recent-mastered');
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
                <Ionicons name="close" size={14} color={c.textSecondary} />
                <Text style={styles.endSessionText}>结束</Text>
              </Pressable>
            </View>
            {card.mode === 'flashcard' && (
              <FlashcardMode key={`${card.item.id}-${session!.currentIndex}`} item={card.item} onGrade={grade} onSkip={skipItem} isRelearn={card.isRelearn} />
            )}
            {card.mode === 'fill-in-blank' && (
              <FillInBlankMode key={`${card.item.id}-${session!.currentIndex}`} item={card.item} onGrade={grade} onSkip={skipItem} isRelearn={card.isRelearn} />
            )}
            {card.mode === 'listen-identify' && (
              <ListenIdentifyMode key={`${card.item.id}-${session!.currentIndex}`} item={card.item} onGrade={grade} onSkip={skipItem} isRelearn={card.isRelearn} />
            )}
            {session!.kind === 'recent-mastered' && (
              <Pressable style={styles.demoteBtn} onPress={() => void demoteCurrent()}>
                <Ionicons name="arrow-undo-outline" size={15} color={c.warning} />
                <Text style={styles.demoteText}>记不清,打回学习</Text>
              </Pressable>
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
                <Ionicons name="library" size={36} color={c.primary} />
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
                <Ionicons name="checkmark-done-circle" size={40} color={c.success} />
                <Text style={styles.heroTitle}>今天复习完了 ✓</Text>
                <Text style={styles.heroSub}>
                  {items.length === 0 ? '还没有保存任何短语 — 去转写里点选单词保存吧' : '到期的词都复习过了,记忆正在巩固'}
                </Text>
                {items.some(i => i.mastery !== 'mastered') && (
                  <Pressable style={styles.practiceBtn} onPress={() => handleStart(true)} disabled={isLoading}>
                    {isLoading
                      ? <ActivityIndicator color={c.primary} />
                      : <Text style={styles.practiceBtnText}>提前练一些</Text>}
                  </Pressable>
                )}
              </View>
            )}

            {/* Mastery breakdown */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: c.warning }]}>{masteryCounts.new}</Text>
                <Text style={styles.statLabel}>新词</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: c.primary }]}>{masteryCounts.learning}</Text>
                <Text style={styles.statLabel}>学习中</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: c.success }]}>{masteryCounts.mastered}</Text>
                <Text style={styles.statLabel}>已掌握</Text>
              </View>
            </View>

            {/* Recently-mastered recall check — sample words that graduated in
                the last N days; "记不清" demotes them back to learning. */}
            {masteryCounts.mastered > 0 && (
              <View style={styles.recallCard}>
                <View style={styles.recallHeader}>
                  <Ionicons name="ribbon-outline" size={18} color={c.primary} />
                  <Text style={styles.recallTitle}>最近掌握抽查</Text>
                </View>
                <Text style={styles.recallSub}>
                  随机抽查最近掌握的词,防止「学过就忘」 — 记不清可一键打回重新学习
                </Text>
                <View style={styles.recallWindows}>
                  {[3, 7, 30].map(days => {
                    const n = recentMasteredCount(days);
                    return (
                      <Pressable
                        key={days}
                        style={[styles.recallChip, (n === 0 || isLoading) && styles.recallChipDisabled]}
                        onPress={() => handleStartRecent(days)}
                        disabled={n === 0 || isLoading}
                      >
                        <Text style={styles.recallChipCount}>{n}</Text>
                        <Text style={styles.recallChipDays}>近 {days} 天</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Palette) {
  return StyleSheet.create({
  screen:           { flex: 1, backgroundColor: c.background },
  scroll:           { padding: 20, flexGrow: 1 },

  progressTrack:    { height: 3, backgroundColor: c.border },
  progressFill:     { height: 3, backgroundColor: c.primary },

  streakBanner:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.warning + '18', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16 },
  streakText:       { fontSize: 15, fontWeight: '700', color: c.text },
  streakSub:        { fontSize: 13, color: c.textSecondary },

  heroCard:         { alignItems: 'center', backgroundColor: c.surface, borderRadius: 20, padding: 28, marginBottom: 20 },
  heroTitle:        { fontSize: 22, fontWeight: '800', color: c.text, marginTop: 12 },
  heroSub:          { fontSize: 14, color: c.textSecondary, marginTop: 6, textAlign: 'center', lineHeight: 20 },
  heroNote:         { fontSize: 12, color: c.textSecondary, marginTop: 12, textAlign: 'center' },

  startBtn:         { backgroundColor: c.primary, borderRadius: 14, paddingHorizontal: 40, paddingVertical: 15, alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
  startBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  practiceBtn:      { borderWidth: 1.5, borderColor: c.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, marginTop: 18 },
  practiceBtnText:  { color: c.primary, fontSize: 14, fontWeight: '700' },

  statsRow:         { flexDirection: 'row', gap: 12 },
  statCard:         { flex: 1, backgroundColor: c.surface, borderRadius: 12, padding: 14, alignItems: 'center' },
  statNum:          { fontSize: 24, fontWeight: '800', color: c.text },
  statLabel:        { fontSize: 12, color: c.textSecondary, marginTop: 2 },

  recallCard:       { backgroundColor: c.surface, borderRadius: 16, padding: 16, marginTop: 16 },
  recallHeader:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recallTitle:      { fontSize: 15, fontWeight: '700', color: c.text },
  recallSub:        { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  recallWindows:    { flexDirection: 'row', gap: 10 },
  recallChip:       { flex: 1, alignItems: 'center', backgroundColor: c.primaryLight, borderRadius: 12, paddingVertical: 10 },
  recallChipDisabled: { opacity: 0.4 },
  recallChipCount:  { fontSize: 20, fontWeight: '800', color: c.primary },
  recallChipDays:   { fontSize: 11, color: c.primary, marginTop: 1, fontWeight: '600' },

  demoteBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', marginTop: 18, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: c.warning + '55', backgroundColor: c.warning + '14' },
  demoteText:       { fontSize: 13, fontWeight: '600', color: c.warning },

  sessionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sessionCounter:   { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  endSessionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  endSessionText:   { fontSize: 13, fontWeight: '600', color: c.textSecondary },

  modeContainer:    { flex: 1 },
  card:             { backgroundColor: c.surface, borderRadius: 16, padding: 24 },
  cardTopRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  masteryDot:       { width: 8, height: 8, borderRadius: 4, marginLeft: 'auto' },
  relearnBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.warning + '1A', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  relearnText:      { fontSize: 12, fontWeight: '700', color: c.warning },
  modeTag:          { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginBottom: 8 },
  cardPhrase:       { fontSize: 26, fontWeight: '800', color: c.text, marginBottom: 16 },
  divider:          { height: 1, backgroundColor: c.border, marginBottom: 16 },
  meaningZh:        { fontSize: 20, fontWeight: '800', color: c.text, marginBottom: 12 },
  meaningMissing:   { fontSize: 14, color: c.textSecondary, fontStyle: 'italic', marginBottom: 12 },
  cardContext:      { fontSize: 15, color: c.textSecondary, fontStyle: 'italic', lineHeight: 22, marginBottom: 16 },
  recallHint:       { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 12 },

  gradePrompt:      { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 10 },
  gradeRow:         { flexDirection: 'row', gap: 8 },
  gradeBtn:         { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  gradeText:        { fontSize: 13, fontWeight: '700' },

  revealBtn:        { backgroundColor: c.primary, borderRadius: 12, padding: 14, alignItems: 'center' },
  revealBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipLink:         { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  skipLinkText:     { fontSize: 13, color: c.textSecondary },

  blankSentence:    { fontSize: 18, color: c.text, lineHeight: 28, marginBottom: 20, fontStyle: 'italic' },
  blankInput:       { borderWidth: 1.5, borderColor: c.border, borderRadius: 10, padding: 12, fontSize: 15, color: c.text, marginBottom: 12 },
  inputCorrect:     { borderColor: c.success, backgroundColor: c.success + '11' },
  inputIncorrect:   { borderColor: c.error,   backgroundColor: c.error   + '11' },
  feedbackRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  feedbackText:     { fontSize: 14, fontWeight: '600' },
  blankActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  skipBtn:          { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border },
  skipBtnText:      { fontSize: 13, color: c.textSecondary },
  checkBtn:         { backgroundColor: c.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  checkBtnText:     { color: '#fff', fontWeight: '700', fontSize: 14 },

  clipBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: c.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16 },
  clipBtnText:      { fontSize: 13, fontWeight: '600', color: c.primary },
  audioRow:         { flexDirection: 'row', gap: 8 },

  noteBlock:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.warning + '14', borderRadius: 10, padding: 12, marginBottom: 12 },
  noteText:         { flex: 1, fontSize: 13, color: c.text, lineHeight: 19 },

  enrichBlock:      { backgroundColor: c.background, borderRadius: 10, padding: 12, marginBottom: 16 },
  enrichZh:         { fontSize: 15, color: c.text, fontWeight: '600', marginBottom: 4 },
  enrichDef:        { fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  enrichSyn:        { fontSize: 13, color: c.primary, marginTop: 6 },

  listenBtn:        { width: 72, height: 72, borderRadius: 36, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 12 },
  listenHint:       { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 16 },
  listenError:      { fontSize: 12, color: c.error, textAlign: 'center', marginBottom: 12 },
  choices:          { gap: 8, marginBottom: 16 },
  choiceBtn:        { borderWidth: 1.5, borderColor: c.border, borderRadius: 10, padding: 14, backgroundColor: c.background },
  choiceCorrect:    { borderColor: c.success, backgroundColor: c.success + '11' },
  choiceIncorrect:  { borderColor: c.error, backgroundColor: c.error + '11' },
  choiceText:       { fontSize: 14, fontWeight: '600', color: c.text },

  summaryCard:      { alignItems: 'center', backgroundColor: c.surface, borderRadius: 20, padding: 32 },
  summaryTitle:     { fontSize: 22, fontWeight: '800', color: c.text, marginTop: 16 },
  summaryScore:     { fontSize: 56, fontWeight: '900', color: c.primary, marginVertical: 8 },
  summarySubtitle:  { fontSize: 14, color: c.textSecondary, marginBottom: 24 },
  endBtn:           { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12 },
  endBtnText:       { color: '#fff', fontWeight: '700' },
  });
}
