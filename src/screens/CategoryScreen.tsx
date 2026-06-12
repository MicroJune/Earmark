import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../types';
import { COLORS } from '../constants/colors';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { pickAudioFile } from '../services/filePicker';
import { transcribeAndSave } from '../services/transcription';
import { getApiKeys } from '../services/config';
import { getSettings } from '../services/settings';
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
  pending:      'Pending',
  transcribing: 'Transcribing…',
  ready:        'Ready',
  error:        'Error',
};

function AudioFileCard({
  item,
  onPress,
  onLongPress,
  selected,
  isSelecting,
}: {
  item: ReturnType<typeof useAudioFilesStore.getState>['audioFiles'][number];
  onPress: () => void;
  onLongPress: () => void;
  selected: boolean;
  isSelecting: boolean;
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
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
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
          <Text style={styles.cardRetryHint}>Tap to retry</Text>
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
    </Pressable>
  );
}

// ─── CategoryScreen ───────────────────────────────────────────────────────────

export default function CategoryScreen({ navigation, route }: Props) {
  const { categoryId, categoryName } = route.params;
  const insets = useSafeAreaInsets();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [moveVisible, setMoveVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const isSelecting = selectedIds.size > 0;
  const { audioFiles, categories, isLoading } = useAudioFilesStore();

  const files = audioFiles.filter(f => f.categoryId === categoryId);

  const exitSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleDeleteSelected = useCallback(() => {
    const count = selectedIds.size;
    Alert.alert(
      `Delete ${count} file${count > 1 ? 's' : ''}`,
      'The audio and transcript will be removed. Your saved phrases are kept and stay reviewable (audio clips are extracted first when possible).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // Sequential — each deletion may decode its file to extract clips
            for (const id of selectedIds) {
              await deleteAudioFileKeepingCards(id);
            }
            exitSelection();
          },
        },
      ]
    );
  }, [selectedIds, exitSelection]);

  const handleMoveSelected = useCallback(async (targetCategoryId: number | null) => {
    await useAudioFilesStore.getState().moveFilesToCategory([...selectedIds], targetCategoryId);
    exitSelection();
  }, [selectedIds, exitSelection]);

  useEffect(() => {
    navigation.setOptions({
      headerLeft: isSelecting ? () => (
        <Pressable onPress={exitSelection} style={{ padding: 4, marginLeft: 4 }}>
          <Text style={{ color: COLORS.primary, fontSize: 15 }}>Cancel</Text>
        </Pressable>
      ) : undefined,
      headerTitle: isSelecting ? `${selectedIds.size} selected` : categoryName,
      headerRight: isSelecting ? () => (
        <View style={{ flexDirection: 'row', gap: 12, marginRight: 4 }}>
          <Pressable onPress={() => setMoveVisible(true)} style={{ padding: 4 }}>
            <Ionicons name="folder-open-outline" size={20} color={COLORS.primary} />
          </Pressable>
          <Pressable onPress={handleDeleteSelected} style={{ padding: 4 }}>
            <Ionicons name="trash-outline" size={20} color={COLORS.error} />
          </Pressable>
        </View>
      ) : undefined,
    });
  }, [navigation, isSelecting, selectedIds.size, categoryName, handleDeleteSelected, exitSelection]);

  // Returns true when the configured engine is ready to transcribe.
  // Otherwise opens Settings with an explanation.
  const ensureEngineReady = useCallback(async (): Promise<boolean> => {
    const settings = await getSettings();
    if (settings.transcriptionEngine === 'local') {
      if (await isModelDownloaded(settings.whisperModel)) return true;
      Alert.alert(
        'Download a model first',
        'On-device transcription needs a Whisper model. Download one in Settings (one-time, then it works offline).'
      );
      setSettingsVisible(true);
      return false;
    }
    const keys = await getApiKeys();
    if (keys?.groqApiKey) return true;
    Alert.alert(
      'API key needed',
      'Cloud transcription needs a free Groq API key (console.groq.com), or switch to the On-device engine in Settings.'
    );
    setSettingsVisible(true);
    return false;
  }, []);

  const startTranscription = useCallback((id: number, uri: string, fileSizeBytes?: number) => {
    transcribeAndSave(id, uri, {
      language: 'en',
      fileSizeBytes,
    }).catch(e => {
      Alert.alert('Transcription failed', e instanceof Error ? e.message : 'Unknown transcription error');
    });
  }, []);

  const handleAddFile = useCallback(async () => {
    try {
      if (!(await ensureEngineReady())) return;

      const picked = await pickAudioFile();
      if (!picked) return;

      const id = await useAudioFilesStore.getState().addAudioFile({
        title: picked.title,
        uri: picked.uri,
        categoryId,
      });

      startTranscription(id, picked.uri, picked.sizeBytes);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Failed to import audio file');
    }
  }, [ensureEngineReady, startTranscription, categoryId]);

  const handleRetry = useCallback(async (id: number) => {
    const file = useAudioFilesStore.getState().audioFiles.find(f => f.id === id);
    if (!file) return;
    Alert.alert('Retry transcription', file.errorMessage ?? 'The last attempt failed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Retry',
        onPress: async () => {
          if (!(await ensureEngineReady())) return;
          startTranscription(id, file.uri);
        },
      },
    ]);
  }, [ensureEngineReady, startTranscription]);

  const handleCardPress = useCallback((id: number, status: string) => {
    if (isSelecting) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    } else if (status === 'ready') {
      navigation.navigate('ContentView', { audioFileId: id });
    } else if (status === 'error' || status === 'pending') {
      void handleRetry(id);
    }
  }, [isSelecting, navigation, handleRetry]);

  const handleCardLongPress = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={files}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => (
          <AudioFileCard
            item={item}
            onPress={() => handleCardPress(item.id, item.status)}
            onLongPress={() => handleCardLongPress(item.id)}
            selected={selectedIds.has(item.id)}
            isSelecting={isSelecting}
          />
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={styles.empty}>
              <Ionicons name="headset-outline" size={64} color={COLORS.border} />
              <Text style={styles.emptyTitle}>No podcasts here yet</Text>
              <Text style={styles.emptySubtitle}>Tap + to import an audio file into this category</Text>
            </View>
          )
        }
      />

      {!isSelecting && (
        <Pressable style={[styles.fab, { bottom: insets.bottom + 24 }]} onPress={handleAddFile}>
          <Ionicons name="add" size={32} color="#fff" />
        </Pressable>
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
  list:           { padding: 16, flexGrow: 1 },

  card:           { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardSelected:   { backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: COLORS.primary },
  cardIcon:       { width: 44, height: 44, borderRadius: 10, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  checkbox:       { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
  checkboxSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  cardBody:       { flex: 1 },
  cardTitle:      { fontSize: 15, fontWeight: '600', color: COLORS.text, marginBottom: 4 },
  cardMeta:       { flexDirection: 'row', gap: 4 },
  cardMetaText:   { fontSize: 12, color: COLORS.textSecondary },
  cardError:      { fontSize: 12, color: COLORS.error, marginTop: 2 },
  cardRetryHint:  { fontSize: 11, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  statusBadge:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  statusText:     { fontSize: 11, fontWeight: '600' },

  fab:            { position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: COLORS.primary, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },

  empty:          { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTitle:     { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 16 },
  emptySubtitle:  { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
