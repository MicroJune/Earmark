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
import { playSavedItemAudio, stopClip } from '../services/audio';
import { speak } from '../services/tts';
import { getReviewStats, type ReviewStats } from '../db/queries/reviewLog';
import { shuffle } from '../utils/spacedRepetition';
import type { ReviewMode, MasteryLevel, SavedItem } from '../types';

// ─── Mastery badge ────────────────────────────────────────────────────────────

const MASTERY_COLOR: Record<MasteryLevel, string> = {
  new:      COLORS.warning,
  learning: COLORS.primary,
  mastered: COLORS.success,
};

// ─── Mode selector ────────────────────────────────────────────────────────────

const MODES: Array<{ mode: ReviewMode; label: string; description: string; icon: string }> = [
  { mode: 'flashcard',      label: 'Flashcard',       description: 'See the phrase — recall its meaning',          icon: 'layers'        },
  { mode: 'fill-in-blank',  label: 'Fill in the Blank', description: 'Complete the sentence with the missing word', icon: 'pencil'        },
  { mode: 'listen-identify', label: 'Listen & Identify', description: 'Hear the audio clip and identify the phrase', icon: 'headset'       },
];

// ─── Session summary ──────────────────────────────────────────────────────────

function SessionSummary({ mode, onRestart, onEnd }: {
  mode: ReviewMode;
  onRestart: () => void;
  onEnd: () => void;
}) {
  const session = useReviewStore(s => s.session);
  if (!session) return null;
  const total = session.correctCount + session.incorrectCount;
  const pct   = total > 0 ? Math.round((session.correctCount / total) * 100) : 0;

  return (
    <View style={styles.summaryCard}>
      <Ionicons name="trophy" size={48} color={COLORS.warning} />
      <Text style={styles.summaryTitle}>Session Complete!</Text>
      <Text style={styles.summaryScore}>{pct}%</Text>
      <Text style={styles.summarySubtitle}>{session.correctCount} correct · {session.incorrectCount} incorrect</Text>
      <View style={styles.summaryActions}>
        <Pressable style={styles.restartBtn} onPress={onRestart}>
          <Text style={styles.restartBtnText}>Review Again</Text>
        </Pressable>
        <Pressable style={styles.endBtn} onPress={onEnd}>
          <Text style={styles.endBtnText}>Done</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Clip play button (hear the phrase in its original audio) ────────────────

function PlayClipButton({ item }: { item: SavedItem }) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => stopClip(), []);

  const handlePlay = async () => {
    setPlaying(true);
    try {
      await playSavedItemAudio(item);
    } catch {
      // clip playback is best-effort; the card still works without audio
    } finally {
      setPlaying(false);
    }
  };

  return (
    <Pressable style={styles.clipBtn} onPress={handlePlay} disabled={playing}>
      {playing
        ? <ActivityIndicator size="small" color={COLORS.primary} />
        : <Ionicons name="volume-high-outline" size={16} color={COLORS.primary} />}
      <Text style={styles.clipBtnText}>Hear it</Text>
    </Pressable>
  );
}

// TTS readout of the saved text — works fully offline via the system voice
function SpeakButton({ text }: { text: string }) {
  return (
    <Pressable style={styles.clipBtn} onPress={() => speak(text)}>
      <Ionicons name="megaphone-outline" size={15} color={COLORS.primary} />
      <Text style={styles.clipBtnText}>Speak</Text>
    </Pressable>
  );
}

// ─── Flashcard mode ───────────────────────────────────────────────────────────

function FlashcardMode() {
  const { session, answerCorrect, answerIncorrect, skipItem } = useReviewStore();
  const [revealed, setRevealed] = useState(false);

  if (!session) return null;
  const item = session.queue[session.currentIndex];
  if (!item) return null;

  const handleNext = () => setRevealed(false);

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />
        <Text style={styles.cardPhrase}>{item.text}</Text>
        <View style={styles.audioRow}>
          <PlayClipButton item={item} />
          <SpeakButton text={item.text} />
        </View>

        {revealed ? (
          <>
            <View style={styles.divider} />
            <Text style={styles.cardContext}>"{item.contextSentence}"</Text>
            {item.enrichment && (
              <View style={styles.enrichBlock}>
                <Text style={styles.enrichZh}>{item.enrichment.translationZh}</Text>
                <Text style={styles.enrichDef}>{item.enrichment.definitionEn}</Text>
                {item.enrichment.synonyms.length > 0 && (
                  <Text style={styles.enrichSyn}>≈ {item.enrichment.synonyms.join(' · ')}</Text>
                )}
              </View>
            )}
            <View style={styles.answerRow}>
              <Pressable style={styles.incorrectBtn} onPress={() => { answerIncorrect(); handleNext(); }}>
                <Ionicons name="close" size={28} color={COLORS.error} />
                <Text style={styles.answerBtnText}>Hard</Text>
              </Pressable>
              <Pressable style={styles.skipBtn} onPress={() => { skipItem(); handleNext(); }}>
                <Text style={styles.skipBtnText}>Skip</Text>
              </Pressable>
              <Pressable style={styles.correctBtn} onPress={() => { answerCorrect(); handleNext(); }}>
                <Ionicons name="checkmark" size={28} color={COLORS.success} />
                <Text style={styles.answerBtnText}>Easy</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable style={styles.revealBtn} onPress={() => setRevealed(true)}>
            <Text style={styles.revealBtnText}>Show Context</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Fill-in-blank mode ───────────────────────────────────────────────────────

function FillInBlankMode() {
  const { session, answerCorrect, answerIncorrect, skipItem } = useReviewStore();
  const [answer, setAnswer] = useState('');
  const [checked, setChecked] = useState(false);

  if (!session) return null;
  const item = session.queue[session.currentIndex];
  if (!item) return null;

  // Build blanked sentence: replace first occurrence of the phrase with underscores.
  // Case-insensitive — saved text and sentence often differ in capitalization,
  // and an unblanked sentence would reveal the answer.
  const escaped = item.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blankedCandidate = item.contextSentence.replace(
    new RegExp(escaped, 'i'),
    '_'.repeat(item.text.length)
  );
  // If the phrase doesn't appear verbatim in the sentence, don't leak the answer.
  const blanked = blankedCandidate === item.contextSentence
    ? '_'.repeat(item.text.length)
    : blankedCandidate;

  const isCorrect = answer.trim().toLowerCase() === item.text.trim().toLowerCase();

  const handleCheck = () => setChecked(true);
  const handleNext  = () => {
    if (isCorrect) answerCorrect(); else answerIncorrect();
    setAnswer('');
    setChecked(false);
  };

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />
        <Text style={styles.blankSentence}>{blanked}</Text>

        <TextInput
          style={[
            styles.blankInput,
            checked && (isCorrect ? styles.inputCorrect : styles.inputIncorrect),
          ]}
          value={answer}
          onChangeText={setAnswer}
          placeholder="Type the missing word or phrase…"
          placeholderTextColor={COLORS.textSecondary}
          editable={!checked}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={handleCheck}
        />

        {checked && (
          <View style={styles.feedbackRow}>
            <Ionicons
              name={isCorrect ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={isCorrect ? COLORS.success : COLORS.error}
            />
            <Text style={[styles.feedbackText, { color: isCorrect ? COLORS.success : COLORS.error }]}>
              {isCorrect ? 'Correct!' : `Answer: ${item.text}`}
            </Text>
          </View>
        )}

        <View style={styles.blankActions}>
          {!checked ? (
            <>
              <Pressable style={styles.skipBtn} onPress={() => { skipItem(); setAnswer(''); }}>
                <Text style={styles.skipBtnText}>Skip</Text>
              </Pressable>
              <Pressable style={styles.checkBtn} onPress={handleCheck} disabled={!answer.trim()}>
                <Text style={styles.checkBtnText}>Check</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.checkBtn} onPress={handleNext}>
              <Text style={styles.checkBtnText}>Next →</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Listen & Identify mode ──────────────────────────────────────────────────
// Plays the original audio clip of the saved phrase; the user picks which
// phrase they heard from a multiple-choice list.

function ListenIdentifyMode() {
  const { session, answerCorrect, answerIncorrect, skipItem } = useReviewStore();
  const allItems = useLibraryStore(s => s.items);

  const currentIndex = session?.currentIndex ?? 0;
  const item = session?.queue[currentIndex] ?? null;

  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Build up to 4 choices: the answer + distractors from the rest of the library
  const choices = useMemo(() => {
    if (!item) return [];
    const distractors = shuffle(
      allItems
        .map(i => i.text)
        .filter((t, idx, arr) => arr.indexOf(t) === idx) // dedupe
        .filter(t => t.toLowerCase() !== item.text.toLowerCase())
    ).slice(0, 3);
    return shuffle([item.text, ...distractors]);
  }, [item?.id, allItems]);

  // Reset per item and stop any clip when leaving the mode
  useEffect(() => {
    setChosen(null);
    setPlayError(null);
    return () => stopClip();
  }, [item?.id]);

  if (!session || !item) return null;

  const handlePlay = async () => {
    setPlayError(null);
    setPlaying(true);
    try {
      await playSavedItemAudio(item);
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : 'Could not play clip');
    } finally {
      setPlaying(false);
    }
  };

  const isCorrect = chosen !== null && chosen === item.text;

  const handleChoose = (choice: string) => {
    if (chosen !== null) return;
    setChosen(choice);
  };

  const handleNext = () => {
    stopClip();
    if (isCorrect) answerCorrect(); else answerIncorrect();
  };

  return (
    <View style={styles.modeContainer}>
      <View style={styles.card}>
        <View style={[styles.masteryDot, { backgroundColor: MASTERY_COLOR[item.mastery] }]} />

        <Pressable style={styles.listenBtn} onPress={handlePlay} disabled={playing}>
          {playing
            ? <ActivityIndicator color="#fff" />
            : <Ionicons name="volume-high" size={32} color="#fff" />}
        </Pressable>
        <Text style={styles.listenHint}>
          {playing ? 'Playing…' : 'Tap to hear the phrase, then pick what you heard'}
        </Text>
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
                onPress={() => handleChoose(choice)}
                disabled={chosen !== null}
              >
                <Text style={styles.choiceText} numberOfLines={2}>{choice}</Text>
              </Pressable>
            );
          })}
        </View>

        {chosen === null ? (
          <View style={styles.blankActions}>
            <Pressable style={styles.skipBtn} onPress={() => { stopClip(); skipItem(); }}>
              <Text style={styles.skipBtnText}>Skip</Text>
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
                {isCorrect ? 'Correct!' : `It was: ${item.text}`}
              </Text>
            </View>
            <View style={styles.blankActions}>
              <Pressable style={styles.checkBtn} onPress={handleNext}>
                <Text style={styles.checkBtnText}>Next →</Text>
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
  const [selectedMode, setSelectedMode] = useState<ReviewMode>('flashcard');

  const { session, isLoading, startSession, endSession } = useReviewStore();
  const items = useLibraryStore(s => s.items);
  const loadItems = useLibraryStore(s => s.loadItems);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const dueCount = items.filter(i => i.mastery !== 'mastered' && (i.nextReview === null || i.nextReview <= Date.now())).length;

  const isFinished = session !== null && session.currentIndex >= session.queue.length;
  const inSession  = session !== null && !isFinished;
  const progress   = session ? session.currentIndex / Math.max(1, session.queue.length) : 0;

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // Refresh streak/today stats whenever the start screen is shown
  useEffect(() => {
    if (!inSession) {
      getReviewStats().then(setStats).catch(() => setStats(null));
    }
  }, [inSession, isFinished]);

  const handleStart = async () => {
    await useLibraryStore.getState().loadItems();
    await startSession(selectedMode);
  };

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      {/* Progress bar */}
      {inSession && (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Finished screen */}
        {isFinished && (
          <SessionSummary
            mode={selectedMode}
            onRestart={() => startSession(selectedMode)}
            onEnd={endSession}
          />
        )}

        {/* Active session */}
        {inSession && (
          <>
            <View style={styles.sessionHeader}>
              <Text style={styles.sessionCounter}>
                {session.currentIndex + 1} / {session.queue.length}
              </Text>
              <Pressable onPress={endSession}>
                <Text style={styles.endSessionText}>End session</Text>
              </Pressable>
            </View>
            {selectedMode === 'flashcard'       && <FlashcardMode />}
            {selectedMode === 'fill-in-blank'   && <FillInBlankMode />}
            {selectedMode === 'listen-identify' && <ListenIdentifyMode />}
          </>
        )}

        {/* Start screen */}
        {!session && (
          <>
            {stats && (stats.streakDays > 0 || stats.reviewedToday > 0) && (
              <View style={styles.streakBanner}>
                <Text style={styles.streakText}>
                  🔥 {stats.streakDays}-day streak
                </Text>
                <Text style={styles.streakSub}>
                  {stats.reviewedToday} reviewed today
                </Text>
              </View>
            )}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{items.length}</Text>
                <Text style={styles.statLabel}>Saved</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: COLORS.warning }]}>{dueCount}</Text>
                <Text style={styles.statLabel}>Due today</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: COLORS.success }]}>
                  {items.filter(i => i.mastery === 'mastered').length}
                </Text>
                <Text style={styles.statLabel}>Mastered</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Choose Mode</Text>
            {MODES.map(m => (
              <Pressable
                key={m.mode}
                style={[styles.modeCard, selectedMode === m.mode && styles.modeCardActive]}
                onPress={() => setSelectedMode(m.mode)}
              >
                <Ionicons
                  name={m.icon as any}
                  size={22}
                  color={selectedMode === m.mode ? COLORS.primary : COLORS.textSecondary}
                />
                <View style={styles.modeCardText}>
                  <Text style={[styles.modeLabel, selectedMode === m.mode && styles.modeLabelActive]}>
                    {m.label}
                  </Text>
                  <Text style={styles.modeDesc}>{m.description}</Text>
                </View>
                {selectedMode === m.mode && (
                  <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />
                )}
              </Pressable>
            ))}

            <Pressable
              style={[styles.startBtn, dueCount === 0 && styles.startBtnDisabled]}
              onPress={handleStart}
              disabled={isLoading || dueCount === 0}
            >
              {isLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.startBtnText}>
                    {dueCount > 0 ? `Start Review (${dueCount} due)` : 'No items due'}
                  </Text>
              }
            </Pressable>
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

  streakBanner:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: COLORS.warning + '18', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 12 },
  streakText:       { fontSize: 15, fontWeight: '700', color: COLORS.text },
  streakSub:        { fontSize: 13, color: COLORS.textSecondary },

  statsRow:         { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard:         { flex: 1, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, alignItems: 'center' },
  statNum:          { fontSize: 24, fontWeight: '800', color: COLORS.text },
  statLabel:        { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  sectionTitle:     { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },

  modeCard:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent' },
  modeCardActive:   { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  modeCardText:     { flex: 1 },
  modeLabel:        { fontSize: 15, fontWeight: '600', color: COLORS.text },
  modeLabelActive:  { color: COLORS.primary },
  modeDesc:         { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  startBtn:         { backgroundColor: COLORS.primary, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  startBtnDisabled: { backgroundColor: COLORS.border },
  startBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },

  sessionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  sessionCounter:   { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },
  endSessionText:   { fontSize: 14, color: COLORS.error },

  modeContainer:    { flex: 1 },
  card:             { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24 },
  masteryDot:       { width: 8, height: 8, borderRadius: 4, alignSelf: 'flex-end', marginBottom: 12 },
  cardPhrase:       { fontSize: 26, fontWeight: '800', color: COLORS.text, marginBottom: 16 },
  divider:          { height: 1, backgroundColor: COLORS.border, marginBottom: 16 },
  cardContext:      { fontSize: 15, color: COLORS.textSecondary, fontStyle: 'italic', lineHeight: 22, marginBottom: 24 },

  answerRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  correctBtn:       { alignItems: 'center', padding: 12, backgroundColor: COLORS.success + '22', borderRadius: 12, flex: 1, marginLeft: 8 },
  incorrectBtn:     { alignItems: 'center', padding: 12, backgroundColor: COLORS.error + '22', borderRadius: 12, flex: 1, marginRight: 8 },
  skipBtn:          { alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border },
  skipBtnText:      { fontSize: 13, color: COLORS.textSecondary },
  answerBtnText:    { fontSize: 12, fontWeight: '600', marginTop: 2, color: COLORS.text },
  revealBtn:        { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  revealBtnText:    { color: '#fff', fontSize: 15, fontWeight: '700' },

  blankSentence:    { fontSize: 18, color: COLORS.text, lineHeight: 28, marginBottom: 20, fontStyle: 'italic' },
  blankInput:       { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 15, color: COLORS.text, marginBottom: 12 },
  inputCorrect:     { borderColor: COLORS.success, backgroundColor: COLORS.success + '11' },
  inputIncorrect:   { borderColor: COLORS.error,   backgroundColor: COLORS.error   + '11' },
  feedbackRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  feedbackText:     { fontSize: 14, fontWeight: '600' },
  blankActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  checkBtn:         { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  checkBtnText:     { color: '#fff', fontWeight: '700', fontSize: 14 },

  clipBtn:          { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: COLORS.primaryLight, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16 },
  clipBtnText:      { fontSize: 13, fontWeight: '600', color: COLORS.primary },
  audioRow:         { flexDirection: 'row', gap: 8 },

  enrichBlock:      { backgroundColor: COLORS.background, borderRadius: 10, padding: 12, marginBottom: 20 },
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
  summaryActions:   { flexDirection: 'row', gap: 12 },
  restartBtn:       { backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12 },
  restartBtnText:   { color: '#fff', fontWeight: '700' },
  endBtn:           { backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border },
  endBtnText:       { color: COLORS.text, fontWeight: '700' },
});
