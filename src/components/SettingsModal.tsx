import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, TextInput, ScrollView,
  ActivityIndicator, Alert, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { getApiKeys, saveApiKeys } from '../services/config';
import {
  getSettings, setTranscriptionEngine, setWhisperModel,
  type TranscriptionEngine, type WhisperModelName,
} from '../services/settings';
import {
  WHISPER_MODELS, downloadModel, deleteModel, getDownloadedModels,
} from '../services/transcription/models';
import { releaseWhisperContext } from '../services/transcription/localWhisper';
import { isLocalEngineSupported } from '../services/transcription/support';
import { exportBackup, importBackup } from '../services/backup';
import { getReminderSettings, setReminder, type ReminderSettings } from '../services/reminders';
import { useLibraryStore } from '../store/libraryStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import StorageModal from './StorageModal';

// Constant for the app's lifetime — native modules can't appear at runtime.
const LOCAL_SUPPORTED = isLocalEngineSupported();

// ─── Engine option card ───────────────────────────────────────────────────────

function EngineOption({
  title, subtitle, icon, active, onPress,
}: {
  title: string; subtitle: string; icon: string; active: boolean; onPress: () => void;
}) {
  return (
    <Pressable style={[styles.engineCard, active && styles.engineCardActive]} onPress={onPress}>
      <Ionicons name={icon as any} size={20} color={active ? COLORS.primary : COLORS.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.engineTitle, active && { color: COLORS.primary }]}>{title}</Text>
        <Text style={styles.engineSubtitle}>{subtitle}</Text>
      </View>
      {active && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
    </Pressable>
  );
}

// ─── Model row ────────────────────────────────────────────────────────────────

function ModelRow({
  label, description, sizeMB, downloaded, isActive, downloadProgress,
  onDownload, onDelete, onSelect,
}: {
  label: string; description: string; sizeMB: number;
  downloaded: boolean; isActive: boolean; downloadProgress: number | null;
  onDownload: () => void; onDelete: () => void; onSelect: () => void;
}) {
  return (
    <Pressable
      style={[styles.modelRow, isActive && downloaded && styles.modelRowActive]}
      onPress={downloaded ? onSelect : undefined}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.modelLabel}>{label}</Text>
        <Text style={styles.modelDesc}>{description}</Text>
        {downloadProgress !== null ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(downloadProgress * 100)}%` }]} />
          </View>
        ) : (
          <Text style={styles.modelSize}>
            {downloaded ? `Downloaded · ${sizeMB} MB` : `${sizeMB} MB download`}
          </Text>
        )}
      </View>

      {downloadProgress !== null ? (
        <Text style={styles.progressPct}>{Math.round(downloadProgress * 100)}%</Text>
      ) : downloaded ? (
        <View style={styles.modelActions}>
          {isActive && <Ionicons name="checkmark-circle" size={22} color={COLORS.primary} />}
          <Pressable onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={COLORS.textSecondary} />
          </Pressable>
        </View>
      ) : (
        <Pressable style={styles.downloadBtn} onPress={onDownload}>
          <Ionicons name="cloud-download-outline" size={16} color="#fff" />
          <Text style={styles.downloadBtnText}>Get</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────

export default function SettingsModal({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const [engine, setEngine] = useState<TranscriptionEngine>('local');
  const [activeModel, setActiveModel] = useState<WhisperModelName>('base.en');
  const [downloaded, setDownloaded] = useState<WhisperModelName[]>([]);
  const [downloading, setDownloading] = useState<Partial<Record<WhisperModelName, number>>>({});

  const [groq, setGroq] = useState('');
  const [anthropic, setAnthropic] = useState('');
  const [saving, setSaving] = useState(false);

  const [reminder, setReminderState] = useState<ReminderSettings>({ enabled: false, hour: 20, minute: 0 });
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [storageVisible, setStorageVisible] = useState(false);

  const refresh = useCallback(async () => {
    const [settings, models, keys, reminderSettings] = await Promise.all([
      getSettings(),
      getDownloadedModels(),
      getApiKeys(),
      getReminderSettings(),
    ]);
    setEngine(settings.transcriptionEngine);
    setActiveModel(settings.whisperModel);
    setDownloaded(models);
    setReminderState(reminderSettings);
    if (keys) { setGroq(keys.groqApiKey); setAnthropic(keys.anthropicApiKey); }
  }, []);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  const handleEngine = async (next: TranscriptionEngine) => {
    setEngine(next);
    await setTranscriptionEngine(next);
  };

  const handleSelectModel = async (model: WhisperModelName) => {
    setActiveModel(model);
    await setWhisperModel(model);
  };

  const handleDownload = async (model: WhisperModelName) => {
    setDownloading(prev => ({ ...prev, [model]: 0 }));
    try {
      await downloadModel(model, fraction =>
        setDownloading(prev => ({ ...prev, [model]: fraction }))
      );
      setDownloaded(prev => [...prev, model]);
      // First downloaded model becomes the active one automatically.
      if (downloaded.length === 0) await handleSelectModel(model);
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : 'Could not download model');
    } finally {
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model];
        return next;
      });
    }
  };

  const handleDeleteModel = (model: WhisperModelName) => {
    Alert.alert('Delete model', 'You can download it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await releaseWhisperContext();
          await deleteModel(model);
          setDownloaded(prev => prev.filter(m => m !== model));
        },
      },
    ]);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not create the backup');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const summary = await importBackup();
      if (summary) {
        // Reload everything the import may have touched
        await Promise.all([
          useLibraryStore.getState().loadItems(),
          useAudioFilesStore.getState().loadAudioFiles(),
          useAudioFilesStore.getState().loadCategories(),
        ]);
        Alert.alert(
          'Import complete',
          `${summary.savedItemsAdded} phrases restored` +
          (summary.savedItemsSkipped > 0 ? ` (${summary.savedItemsSkipped} already existed)` : '') +
          (summary.categoriesAdded > 0 ? `\n${summary.categoriesAdded} categories added` : '') +
          (summary.audioFilesAdded > 0 ? `\n${summary.audioFilesAdded} file entries restored — re-import the audio files to listen` : '')
        );
      }
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Could not read the backup file');
    } finally {
      setImporting(false);
    }
  };

  const applyReminder = async (next: ReminderSettings) => {
    const prev = reminder;
    setReminderState(next);
    try {
      await setReminder(next);
    } catch (e) {
      setReminderState(prev);
      Alert.alert('Reminder not set', e instanceof Error ? e.message : 'Could not schedule the reminder');
    }
  };

  const handleSaveKeys = async () => {
    setSaving(true);
    try {
      await saveApiKeys({ groqApiKey: groq.trim(), anthropicApiKey: anthropic.trim() });
      Alert.alert('Saved', 'API keys updated.');
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Failed to save API keys.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Engine */}
          <Text style={styles.sectionTitle}>Transcription</Text>
          <EngineOption
            title="On-device (offline)"
            subtitle={LOCAL_SUPPORTED
              ? 'Free, private, no file size limit. Slower on old phones.'
              : 'Not available in Expo Go — needs the development build.'}
            icon="phone-portrait-outline"
            active={engine === 'local'}
            onPress={() => {
              if (!LOCAL_SUPPORTED) {
                Alert.alert(
                  'Development build required',
                  'On-device transcription uses native code that Expo Go does not include. ' +
                  'Build the app with EAS (see OFFLINE_SETUP.md) to unlock offline mode. ' +
                  'Until then, use the Cloud engine.'
                );
                return;
              }
              void handleEngine('local');
            }}
          />
          {!LOCAL_SUPPORTED && engine === 'local' && (
            <View style={styles.warnBanner}>
              <Ionicons name="warning-outline" size={16} color={COLORS.warning} />
              <Text style={styles.warnText}>
                You're in Expo Go, so the on-device engine can't run — transcription will fail.
                Switch to Cloud below, or install the development build for offline mode.
              </Text>
            </View>
          )}
          <EngineOption
            title="Cloud (Groq Whisper)"
            subtitle="Fast, needs internet + free API key. 25 MB file limit."
            icon="cloud-outline"
            active={engine === 'cloud'}
            onPress={() => handleEngine('cloud')}
          />

          {/* Models */}
          {engine === 'local' && LOCAL_SUPPORTED && (
            <>
              <Text style={styles.sectionTitle}>Whisper model</Text>
              <Text style={styles.hint}>
                Download once over Wi-Fi — after that, transcription works with no internet at all.
              </Text>
              {WHISPER_MODELS.map(m => (
                <ModelRow
                  key={m.name}
                  label={m.label}
                  description={m.description}
                  sizeMB={m.sizeMB}
                  downloaded={downloaded.includes(m.name)}
                  isActive={activeModel === m.name}
                  downloadProgress={downloading[m.name] ?? null}
                  onDownload={() => handleDownload(m.name)}
                  onDelete={() => handleDeleteModel(m.name)}
                  onSelect={() => handleSelectModel(m.name)}
                />
              ))}
            </>
          )}

          {/* Daily reminder */}
          <Text style={styles.sectionTitle}>Daily review reminder</Text>
          <View style={styles.reminderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reminderTitle}>Remind me to review</Text>
              <Text style={styles.reminderSubtitle}>
                A local notification — works fully offline
              </Text>
            </View>
            <Switch
              value={reminder.enabled}
              onValueChange={v => applyReminder({ ...reminder, enabled: v })}
              trackColor={{ true: COLORS.primary }}
            />
          </View>
          {reminder.enabled && (
            <View style={styles.timeRow}>
              {[
                { label: '8:00', hour: 8, minute: 0 },
                { label: '12:30', hour: 12, minute: 30 },
                { label: '20:00', hour: 20, minute: 0 },
                { label: '21:30', hour: 21, minute: 30 },
              ].map(t => {
                const active = reminder.hour === t.hour && reminder.minute === t.minute;
                return (
                  <Pressable
                    key={t.label}
                    style={[styles.timeChip, active && styles.timeChipActive]}
                    onPress={() => applyReminder({ ...reminder, hour: t.hour, minute: t.minute })}
                  >
                    <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Data & storage */}
          <Text style={styles.sectionTitle}>Data & storage</Text>
          <Pressable style={styles.dataBtn} onPress={handleExport} disabled={exporting}>
            {exporting
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <Ionicons name="download-outline" size={18} color={COLORS.primary} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.dataBtnTitle}>Export backup</Text>
              <Text style={styles.dataBtnSubtitle}>Saved phrases, categories and review history as a JSON file</Text>
            </View>
          </Pressable>
          <Pressable style={styles.dataBtn} onPress={handleImport} disabled={importing}>
            {importing
              ? <ActivityIndicator size="small" color={COLORS.primary} />
              : <Ionicons name="push-outline" size={18} color={COLORS.primary} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.dataBtnTitle}>Import backup</Text>
              <Text style={styles.dataBtnSubtitle}>Merge a backup file — safe to run twice, no duplicates</Text>
            </View>
          </Pressable>
          <Pressable style={styles.dataBtn} onPress={() => setStorageVisible(true)}>
            <Ionicons name="server-outline" size={18} color={COLORS.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dataBtnTitle}>Manage storage</Text>
              <Text style={styles.dataBtnSubtitle}>See usage and free space without losing learning cards</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
          </Pressable>

          {/* API keys */}
          <Text style={styles.sectionTitle}>API keys</Text>
          <Text style={styles.label}>
            Groq API key {engine === 'cloud' ? '(required for cloud transcription)' : '(not needed for on-device)'}
          </Text>
          <TextInput
            style={styles.input}
            value={groq}
            onChangeText={setGroq}
            placeholder="gsk_..."
            secureTextEntry
            autoCapitalize="none"
          />

          <Text style={styles.label}>Anthropic API key (optional — for AI phrase suggestions)</Text>
          <TextInput
            style={styles.input}
            value={anthropic}
            onChangeText={setAnthropic}
            placeholder="sk-ant-..."
            secureTextEntry
            autoCapitalize="none"
          />

          <Text style={styles.hint}>
            Keys are stored securely on your device only.
          </Text>

          <Pressable style={styles.saveBtn} onPress={handleSaveKeys} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save keys</Text>}
          </Pressable>
        </ScrollView>

        <StorageModal visible={storageVisible} onClose={() => setStorageVisible(false)} />
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modal:           { flex: 1, padding: 24, backgroundColor: COLORS.background },
  modalHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle:      { fontSize: 20, fontWeight: '700', color: COLORS.text },

  sectionTitle:    { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 10 },

  engineCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: 'transparent' },
  engineCardActive:{ borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  engineTitle:     { fontSize: 14, fontWeight: '600', color: COLORS.text },
  engineSubtitle:  { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  modelRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: 'transparent' },
  modelRowActive:  { borderColor: COLORS.primary },
  modelLabel:      { fontSize: 14, fontWeight: '600', color: COLORS.text },
  modelDesc:       { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  modelSize:       { fontSize: 11, color: COLORS.textSecondary, marginTop: 4 },
  modelActions:    { flexDirection: 'row', alignItems: 'center', gap: 10 },

  downloadBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  downloadBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  progressTrack:   { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginTop: 8 },
  progressFill:    { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  progressPct:     { fontSize: 12, fontWeight: '600', color: COLORS.primary, width: 40, textAlign: 'right' },

  warnBanner:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: COLORS.warning + '18', borderRadius: 10, padding: 12, marginBottom: 8 },
  warnText:        { flex: 1, fontSize: 12, color: COLORS.text, lineHeight: 17 },

  reminderRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  reminderTitle:   { fontSize: 14, fontWeight: '600', color: COLORS.text },
  reminderSubtitle:{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  timeRow:         { flexDirection: 'row', gap: 8, marginBottom: 8 },
  timeChip:        { borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 7 },
  timeChipActive:  { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  timeChipText:    { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },
  timeChipTextActive: { color: COLORS.primary },

  dataBtn:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  dataBtnTitle:    { fontSize: 14, fontWeight: '600', color: COLORS.text },
  dataBtnSubtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  label:           { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 },
  input:           { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 14, color: COLORS.text, marginBottom: 16, backgroundColor: COLORS.surface },
  hint:            { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 12 },
  saveBtn:         { backgroundColor: COLORS.primary, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 40 },
  saveBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
});
