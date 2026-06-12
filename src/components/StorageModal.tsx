import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, Pressable, FlatList, Alert, StyleSheet,
} from 'react-native';
import { File, Directory, Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { deleteAudioFileKeepingCards, previewAudioFileDeletion } from '../services/fileDeletion';
import { getClipsStorageBytes } from '../services/clips';

// ─── Storage management ───────────────────────────────────────────────────────
// Imported audio piles up (podcasts are 20–80 MB each). This screen makes the
// usage visible and offers "remove audio, keep cards": the episode and its
// transcript go away, the learning cards stay reviewable via extracted clips.

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function safeFileSize(uri: string): number {
  if (!uri) return 0;
  try {
    const f = new File(uri);
    return f.exists ? (f.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

function dirSize(name: string): number {
  try {
    const dir = new Directory(Paths.document, name);
    if (!dir.exists) return 0;
    let total = 0;
    for (const entry of dir.list()) {
      if (entry instanceof File) total += entry.size ?? 0;
    }
    return total;
  } catch {
    return 0;
  }
}

interface FileRow {
  id: number;
  title: string;
  sizeBytes: number;
  phraseCount: number;
}

export default function StorageModal({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const audioFiles = useAudioFilesStore(s => s.audioFiles);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [modelsBytes, setModelsBytes] = useState(0);
  const [clipsBytes, setClipsBytes] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    setRows(
      audioFiles
        .map(f => ({
          id: f.id,
          title: f.title,
          sizeBytes: safeFileSize(f.uri),
          phraseCount: f.phraseCount,
        }))
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
    );
    setModelsBytes(dirSize('whisper-models'));
    setClipsBytes(getClipsStorageBytes());
  }, [audioFiles]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  const audioBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);

  const handleRemoveAudio = async (row: FileRow) => {
    const preview = await previewAudioFileDeletion(row.id);
    const clipNote = preview.savedItemCount === 0
      ? ''
      : preview.clipsWillBeExtracted
        ? `\n\nYour ${preview.savedItemCount} saved phrase${preview.savedItemCount > 1 ? 's' : ''} stay reviewable — audio clips are extracted first.`
        : `\n\nYour ${preview.savedItemCount} saved phrase${preview.savedItemCount > 1 ? 's' : ''} are kept, but clips can't be extracted in Expo Go — their original audio will be lost.`;
    Alert.alert(
      `Free up ${formatBytes(row.sizeBytes)}`,
      `"${row.title}" and its transcript will be removed.${clipNote}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove audio',
          style: 'destructive',
          onPress: async () => {
            setBusyId(row.id);
            try {
              await deleteAudioFileKeepingCards(row.id);
            } catch (e) {
              Alert.alert('Failed', e instanceof Error ? e.message : 'Could not remove the file');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>Storage</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        {/* Totals */}
        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Imported audio</Text>
            <Text style={styles.totalValue}>{formatBytes(audioBytes)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Whisper models</Text>
            <Text style={styles.totalValue}>{formatBytes(modelsBytes)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Saved phrase clips</Text>
            <Text style={styles.totalValue}>{formatBytes(clipsBytes)}</Text>
          </View>
          <Text style={styles.hint}>
            Models can be removed in Settings → Whisper model. Removing an episode below keeps
            its saved phrases reviewable.
          </Text>
        </View>

        <FlatList
          data={rows}
          keyExtractor={r => String(r.id)}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowMeta}>
                  {formatBytes(item.sizeBytes)}
                  {item.phraseCount > 0 ? `  ·  ${item.phraseCount} saved phrase${item.phraseCount > 1 ? 's' : ''}` : ''}
                </Text>
              </View>
              <Pressable
                style={styles.removeBtn}
                onPress={() => handleRemoveAudio(item)}
                disabled={busyId !== null}
              >
                <Text style={styles.removeBtnText}>
                  {busyId === item.id ? 'Removing…' : 'Remove audio'}
                </Text>
              </Pressable>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>No imported audio files.</Text>
          }
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal:       { flex: 1, padding: 24, backgroundColor: COLORS.background },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title:       { fontSize: 20, fontWeight: '700', color: COLORS.text },

  totals:      { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 16 },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel:  { fontSize: 14, color: COLORS.text },
  totalValue:  { fontSize: 14, fontWeight: '700', color: COLORS.text },
  hint:        { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17, marginTop: 8 },

  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  rowTitle:    { fontSize: 14, fontWeight: '600', color: COLORS.text },
  rowMeta:     { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  removeBtn:   { borderWidth: 1, borderColor: COLORS.error, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  removeBtnText: { fontSize: 12, fontWeight: '600', color: COLORS.error },

  empty:       { textAlign: 'center', color: COLORS.textSecondary, marginTop: 24, fontSize: 13 },
});
