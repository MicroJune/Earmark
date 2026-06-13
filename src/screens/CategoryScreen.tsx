import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, ScrollView,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList, AudioFile } from '../types';
import { COLORS } from '../constants/colors';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { pickAudioFiles, getAudioFileSize } from '../services/filePicker';
import { transcribeAndSave } from '../services/transcription';
import { getApiKeys } from '../services/config';
import {
  getSettings, getFileSortMode, setFileSortMode, type FileSortMode,
} from '../services/settings';
import { isModelDownloaded } from '../services/transcription/models';
import { formatDuration, formatRelativeDate } from '../utils/timeFormat';
import { deleteAudioFileKeepingCards } from '../services/fileDeletion';
import SettingsModal from '../components/SettingsModal';
import MoveToCategoryModal from '../components/MoveToCategoryModal';

type Props = NativeStackScreenProps<HomeStackParamList, 'CategoryView'>;

// ─── Audio file card ──────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:      COLORS.textSecondary,
  transcribing: COLORS.warning,
  ready:        COLORS.success,
  error:        COLORS.error,
};

const STATUS_LABEL: Record<string, string> = {
  pending:      '待转写',
  transcribing: '转写中…',
  ready:        'Ready',
  error:        'Error',
};

const SORT_LABEL: Record<FileSortMode, string> = {
  date:   '按添加时间',
  name:   '按文件名',
  size:   '按文件大小',
  manual: '自定义顺序',
};

function AudioFileCard({
  item,
  onPress,
  onLongPress,
  selected,
  isSelecting,
  manualMode,
  onMoveUp,
  onMoveDown,
}: {
  item: AudioFile;
  onPress: () => void;
  onLongPress: () => void;
  selected: boolean;
  isSelecting: boolean;
  manualMode: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const progress = useAudioFilesStore(s => s.transcriptionProgress[item.id]);

  const statusLabel =
    item.status === 'transcribing' && progress !== undefined
      ? `${Math.round(progress * 100)}%`
      : STATUS_LABEL[item.status];

  // Listening progress — only meaningful once duration is known
  const listenedPercent =
    item.duration > 0 && item.lastPosition > 5
      ? Math.min(99, Math.round((item.lastPosition / item.duration) * 100))
      : 0;

  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!isSelecting && item.status === 'transcribing'}
    >
      <View style={styles.cardIcon}>
        {isSelecting ? (
          <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
            {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
        ) : (
          <Ionicons name="musical-notes" size={24} color={COLORS.primary} />
        )}
      </View>
      <View style={styles.cardBody}>
        {/* Long titles: horizontally scrollable so the full name is reachable.
            The inner Pressable is essential: a ScrollView cannot steal the
            gesture from an ANCESTOR Pressable (the card), but it can steal it
            from its own child — so horizontal drags scroll the title while
            taps/long-presses are forwarded to the card handlers. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.titleScroll}>
          <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            disabled={!isSelecting && item.status === 'transcribing'}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
          </Pressable>
        </ScrollView>
        <View style={styles.cardMeta}>
          {item.duration > 0 && (
            <Text style={styles.cardMetaText}>{formatDuration(item.duration)}</Text>
          )}
          <Text style={styles.cardMetaText}>·</Text>
          <Text style={styles.cardMetaText}>{formatRelativeDate(item.dateAdded)}</Text>
          {item.phraseCount > 0 && (
            <>
              <Text style={styles.cardMetaText}>·</Text>
              <Text style={styles.cardMetaText}>{item.phraseCount} saved</Text>
            </>
          )}
          {listenedPercent > 0 && (
            <>
              <Text style={styles.cardMetaText}>·</Text>
              <Text style={[styles.cardMetaText, { color: COLORS.primary }]}>{listenedPercent}% listened</Text>
            </>
          )}
        </View>
        {item.errorMessage && (
          <Text style={styles.cardError} numberOfLines={2}>{item.errorMessage}</Text>
        )}
        {item.status === 'error' && (
          <Text style={styles.cardRetryHint}>点击重试转写</Text>
        )}
        {item.status === 'pending' && (
          <Text style={styles.cardRetryHint}>点击开始转写</Text>
        )}
      </View>

      <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '22' }]}>
        <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>
          {statusLabel}
        </Text>
        {item.status === 'transcribing' && (
          <ActivityIndicator size="small" color={COLORS.warning} style={{ marginLeft: 4 }} />
        )}
      </View>

      {manualMode && !isSelecting && (
        <View style={styles.reorderCol}>
          <Pressable onPress={onMoveUp} hitSlop={6} disabled={!onMoveUp} style={{ opacity: onMoveUp ? 1 : 0.25 }}>
            <Ionicons name="chevron-up" size={18} color={COLORS.primary} />
          </Pressable>
          <Pressable onPress={onMoveDown} hitSlop={6} disabled={!onMoveDown} style={{ opacity: onMoveDown ? 1 : 0.25 }}>
            <Ionicons name="chevron-down" size={18} color={COLORS.primary} />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

// ─── Sorting helpers ──────────────────────────────────────────────────────────

function sortFiles(
  files: AudioFile[],
  mode: FileSortMode,
  sizes: Map<number, number>
): AudioFile[] {
  const arr = [...files];
  switch (mode) {
    case 'name':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'size':
      return arr.sort((a, b) => (sizes.get(b.id) ?? 0) - (sizes.get(a.id) ?? 0));
    case 'manual':
      return arr.sort((a, b) => {
        // Manually positioned files first (by position); unplaced ones after, newest first
        if (a.sortOrder === null && b.sortOrder === null) return b.dateAdded - a.dateAdded;
        if (a.sortOrder === null) return 1;
        if (b.sortOrder === null) return -1;
        return a.sortOrder - b.sortOrder;
      });
    case 'date':
    default:
      return arr.sort((a, b) => b.dateAdded - a.dateAdded);
  }
}

// ─── CategoryScreen ───────────────────────────────────────────────────────────

export default function CategoryScreen({ navigation, route }: Props) {
  const { categoryId, categoryName } = route.params;
  const insets = useSafeAreaInsets();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [moveVisible, setMoveVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<FileSortMode>('date');
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const isSelecting = selectedIds.size > 0;
  const { audioFiles, categories, isLoading } = useAudioFilesStore();

  useEffect(() => { void getFileSortMode().then(setSortMode); }, []);

  const files = useMemo(
    () => audioFiles.filter(f => f.categoryId === categoryId),
    [audioFiles, categoryId]
  );

  // File sizes are only needed for size-sorting; read lazily and memoized.
  const sizes = useMemo(() => {
    const map = new Map<number, number>();
    if (sortMode !== 'size') return map;
    for (const f of files) {
      try { map.set(f.id, f.uri ? getAudioFileSize(f.uri) : 0); } catch { map.set(f.id, 0); }
    }
    return map;
  }, [files, sortMode]);

  // Full sorted list (the manual-reorder source of truth), then search filter.
  const sortedFiles = useMemo(() => sortFiles(files, sortMode, sizes), [files, sortMode, sizes]);
  const displayedFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sortedFiles.filter(f => f.title.toLowerCase().includes(q)) : sortedFiles;
  }, [sortedFiles, query]);

  // Reordering works on the unfiltered list — hidden while searching.
  const manualMode = sortMode === 'manual' && query.trim() === '';

  const exitSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Tap to cycle through sort modes (Android Alert can't show 4+ options)
  const handleSortPress = useCallback(() => {
    const cycle: FileSortMode[] = ['date', 'name', 'size', 'manual'];
    const next = cycle[(cycle.indexOf(sortMode) + 1) % cycle.length];
    setSortMode(next);
    void setFileSortMode(next);
  }, [sortMode]);

  const handleMove = useCallback((id: number, direction: -1 | 1) => {
    const ids = sortedFiles.map(f => f.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void useAudioFilesStore.getState().reorderFiles(ids);
  }, [sortedFiles]);

  // ── Delete (with progress — clip extraction makes each file slow) ──────────
  const handleDeleteSelected = useCallback(() => {
    const ids = [...selectedIds];
    Alert.alert(
      `删除 ${ids.length} 个文件`,
      '音频和转写会被删除;已保存的短语会保留并可继续复习(删除前会先提取它们的原声片段)。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            exitSelection();
            setDeleteProgress({ done: 0, total: ids.length });
            try {
              for (let i = 0; i < ids.length; i++) {
                await deleteAudioFileKeepingCards(ids[i]);
                setDeleteProgress({ done: i + 1, total: ids.length });
              }
            } finally {
              setDeleteProgress(null);
            }
          },
        },
      ]
    );
  }, [selectedIds, exitSelection]);

  const handleMoveSelected = useCallback(async (targetCategoryId: number | null) => {
    await useAudioFilesStore.getState().moveFilesToCategory([...selectedIds], targetCategoryId);
    exitSelection();
  }, [selectedIds, exitSelection]);

  // ── Transcription (manual start) ────────────────────────────────────────────

  // Returns true when the configured engine is ready to transcribe.
  // Otherwise opens Settings with an explanation.
  const ensureEngineReady = useCallback(async (): Promise<boolean> => {
    const settings = await getSettings();
    if (settings.transcriptionEngine === 'local') {
      if (await isModelDownloaded(settings.whisperModel)) return true;
      Alert.alert(
        '还差一步:下载语音模型',
        '离线转写需要先下载一个语音模型(一次性,之后完全离线)。\n\n打开 设置 → 转写引擎,点「下载」即可。'
      );
      setSettingsVisible(true);
      return false;
    }
    const keys = await getApiKeys();
    if (keys.volcApiKey) return true;
    Alert.alert(
      '还差一步:填写 API Key',
      '云端转写需要火山引擎语音 API Key。\n\n打开 设置 → 转写引擎,按页面指引填写;或切换为离线转写。'
    );
    setSettingsVisible(true);
    return false;
  }, []);

  // Sequential queue — whisper can't run files in parallel anyway. Failures
  // mark the file 'error' (done inside transcribeAndSave) and the queue moves on.
  const runTranscriptionQueue = useCallback(async (ids: number[]) => {
    if (!(await ensureEngineReady())) return;
    for (const id of ids) {
      const file = useAudioFilesStore.getState().audioFiles.find(f => f.id === id);
      if (!file || (file.status !== 'pending' && file.status !== 'error')) continue;
      try {
        await transcribeAndSave(id, file.uri, { language: 'en' });
      } catch {
        // status is already set to 'error' with the message — keep going
      }
    }
  }, [ensureEngineReady]);

  const handleTranscribeSelected = useCallback(() => {
    const ids = [...selectedIds].filter(id => {
      const f = useAudioFilesStore.getState().audioFiles.find(x => x.id === id);
      return f && (f.status === 'pending' || f.status === 'error');
    });
    exitSelection();
    if (ids.length === 0) {
      Alert.alert('没有可转写的文件', '所选文件都已经转写完成或正在转写。');
      return;
    }
    void runTranscriptionQueue(ids);
  }, [selectedIds, exitSelection, runTranscriptionQueue]);

  // ── Import (no auto-transcription) ──────────────────────────────────────────
  const handleAddFiles = useCallback(async () => {
    setImporting(true);
    try {
      const picked = await pickAudioFiles();
      if (picked.length === 0) return;

      const store = useAudioFilesStore.getState();
      for (const file of picked) {
        await store.addAudioFile({ title: file.title, uri: file.uri, categoryId });
      }
      // No automatic transcription — the user starts it per file or in batch.
    } catch (e) {
      Alert.alert('导入失败', e instanceof Error ? e.message : '无法导入音频文件');
    } finally {
      setImporting(false);
    }
  }, [categoryId]);

  const handleCardPress = useCallback((file: AudioFile) => {
    if (isSelecting) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(file.id)) next.delete(file.id); else next.add(file.id);
        return next;
      });
    } else if (file.status === 'ready') {
      navigation.navigate('ContentView', { audioFileId: file.id });
    } else if (file.status === 'pending' || file.status === 'error') {
      void runTranscriptionQueue([file.id]);
    }
  }, [isSelecting, navigation, runTranscriptionQueue]);

  const handleCardLongPress = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // ── Header ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    navigation.setOptions({
      headerLeft: isSelecting ? () => (
        <Pressable onPress={exitSelection} style={{ padding: 4, marginLeft: 4 }}>
          <Text style={{ color: COLORS.primary, fontSize: 15 }}>取消</Text>
        </Pressable>
      ) : undefined,
      headerTitle: isSelecting ? `已选 ${selectedIds.size} 项` : categoryName,
      headerRight: isSelecting ? () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginRight: 4 }}>
          <Pressable onPress={handleTranscribeSelected} style={{ padding: 2 }}>
            <Text style={{ color: COLORS.primary, fontSize: 14, fontWeight: '600' }}>转写</Text>
          </Pressable>
          <Pressable onPress={() => setMoveVisible(true)} style={{ padding: 4 }}>
            <Ionicons name="folder-open-outline" size={20} color={COLORS.primary} />
          </Pressable>
          <Pressable onPress={handleDeleteSelected} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={20} color={COLORS.error} />
          </Pressable>
        </View>
      ) : undefined,
    });
  }, [navigation, isSelecting, selectedIds.size, categoryName, handleDeleteSelected, handleTranscribeSelected, exitSelection]);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      {/* Search + sort */}
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={15} color={COLORS.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="搜索文件名…"
            placeholderTextColor={COLORS.textSecondary}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={6}>
              <Ionicons name="close-circle" size={15} color={COLORS.textSecondary} />
            </Pressable>
          )}
        </View>
        <Pressable style={styles.sortBtn} onPress={handleSortPress}>
          <Ionicons name="swap-vertical" size={13} color={COLORS.primary} />
          <Text style={styles.sortBtnText}>{SORT_LABEL[sortMode]}</Text>
        </Pressable>
      </View>

      <FlatList
        data={displayedFiles}
        keyExtractor={item => String(item.id)}
        renderItem={({ item, index }) => (
          <AudioFileCard
            item={item}
            onPress={() => handleCardPress(item)}
            onLongPress={() => handleCardLongPress(item.id)}
            selected={selectedIds.has(item.id)}
            isSelecting={isSelecting}
            manualMode={manualMode}
            onMoveUp={manualMode && index > 0 ? () => handleMove(item.id, -1) : undefined}
            onMoveDown={manualMode && index < displayedFiles.length - 1 ? () => handleMove(item.id, 1) : undefined}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.empty}>
              <Ionicons name={query ? 'search-outline' : 'headset-outline'} size={64} color={COLORS.border} />
              <Text style={styles.emptyTitle}>{query ? '没有匹配的文件' : 'No podcasts here yet'}</Text>
              <Text style={styles.emptySubtitle}>
                {query ? '换个关键词试试' : 'Tap + to import audio files into this category'}
              </Text>
            </View>
          )
        }
      />

      {!isSelecting && (
        <Pressable style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={handleAddFiles} disabled={importing}>
          {importing
            ? <ActivityIndicator color="#fff" />
            : <Ionicons name="add" size={32} color="#fff" />}
        </Pressable>
      )}

      {/* Delete progress overlay */}
      {deleteProgress && (
        <View style={styles.progressOverlay}>
          <View style={styles.progressCard}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.progressTitle}>
                正在删除 {Math.min(deleteProgress.done + 1, deleteProgress.total)}/{deleteProgress.total} 个文件…
              </Text>
              <Text style={styles.progressSubtitle}>正在为已保存的短语提取原声片段,请稍候</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round((deleteProgress.done / deleteProgress.total) * 100)}%` }]} />
              </View>
            </View>
          </View>
        </View>
      )}

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <MoveToCategoryModal
        visible={moveVisible}
        categories={categories}
        currentCategoryId={categoryId}
        onSelect={handleMoveSelected}
        onClose={() => setMoveVisible(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:         { flex: 1, backgroundColor: COLORS.background },
  list:           { padding: 16, paddingTop: 8, flexGrow: 1 },

  toolbar:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  searchBox:      { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.border },
  searchInput:    { flex: 1, paddingVertical: 8, fontSize: 13, color: COLORS.text },
  sortBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: COLORS.primaryLight, borderRadius: 10 },
  sortBtnText:    { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  card:           { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardSelected:   { backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: COLORS.primary },
  cardIcon:       { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkbox:       { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  cardBody:       { flex: 1 },
  titleScroll:    { marginBottom: 4 },
  cardTitle:      { fontSize: 15, fontWeight: '600', color: COLORS.text },
  cardMeta:       { flexDirection: 'row', gap: 4 },
  cardMetaText:   { fontSize: 12, color: COLORS.textSecondary },
  cardError:      { fontSize: 12, color: COLORS.error, marginTop: 2 },
  cardRetryHint:  { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  statusBadge:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  statusText:     { fontSize: 11, fontWeight: '600' },

  reorderCol:     { marginLeft: 6, alignItems: 'center', gap: 6 },

  fab:            { position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },

  progressOverlay:{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end', padding: 16 },
  progressCard:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, elevation: 8 },
  progressTitle:  { fontSize: 14, fontWeight: '700', color: COLORS.text },
  progressSubtitle:{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  progressTrack:  { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginTop: 8 },
  progressFill:   { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },

  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTitle:     { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 16 },
  emptySubtitle:  { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
