import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView,
  Alert, StyleSheet, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../constants/colors';
import { getApiKeys, saveApiKeys, type ApiKeys } from '../services/config';
import {
  getSettings, setTranscriptionEngine, setWhisperModel, setModelMirror,
  setAiProvider, setAiEnabled, getHideMeaning, setHideMeaning,
  type TranscriptionEngine, type WhisperModelName, type ModelMirror, type AiProvider,
} from '../services/settings';
import { downloadModel, deleteModel, getDownloadedModels } from '../services/transcription/models';
import { releaseWhisperContext } from '../services/transcription/localWhisper';
import { isLocalEngineSupported } from '../services/transcription/support';
import { exportBackup, importBackup } from '../services/backup';
import {
  getReminderSettings, setReminder, remindersSupported,
  type ReminderSettings,
} from '../services/reminders';
import {
  getEnglishVoices, getTtsSettings, setTtsVoice, setTtsRate, speakSample,
  setTtsProvider, setVolcanoVoice, speakVolcanoSample,
  type TtsVoice, type TtsProvider,
} from '../services/tts';
import { DEFAULT_VOLCANO_VOICE, VOLCANO_VOICES } from '../services/volcano';
import { useLibraryStore } from '../store/libraryStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { HubRow, type Tone } from './settings/ui';
import EnginePage from './settings/EnginePage';
import TtsPage from './settings/TtsPage';
import AiPage from './settings/AiPage';
import DataPage from './settings/DataPage';
import UpdatesPage from './settings/UpdatesPage';
import LogViewerModal from './LogViewerModal';

// Constant for the app's lifetime — native modules can't appear at runtime.
const LOCAL_SUPPORTED = isLocalEngineSupported();

type Page = 'home' | 'engine' | 'tts' | 'ai' | 'data' | 'updates';

const PAGE_TITLES: Record<Page, string> = {
  home: '设置',
  engine: '转写引擎',
  tts: '发音朗读',
  ai: 'AI 学习笔记',
  data: '数据与存储',
  updates: '应用更新',
};

// ─── SettingsModal — hub with sub-pages ───────────────────────────────────────

export default function SettingsModal({
  visible, onClose,
}: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('home');

  // Transcription
  const [engine, setEngine] = useState<TranscriptionEngine>('local');
  const [activeModel, setActiveModel] = useState<WhisperModelName>('base.en');
  const [downloaded, setDownloaded] = useState<WhisperModelName[]>([]);
  const [downloading, setDownloading] = useState<Partial<Record<WhisperModelName, number>>>({});
  const [mirror, setMirror] = useState<ModelMirror>('huggingface');

  // AI
  const [aiEnabled, setAiEnabledState] = useState(true);
  const [aiProvider, setAiProviderState] = useState<AiProvider>('volcano');
  const [hideMeaning, setHideMeaningState] = useState(true);

  // API keys (auto-saved on blur — see saveKey)
  const [keys, setKeys] = useState<ApiKeys>({ volcApiKey: '', arkApiKey: '', deepseekApiKey: '' });

  // Reminder
  const [reminder, setReminderState] = useState<ReminderSettings>({ enabled: false, hour: 20, minute: 0 });

  // Backup
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Diagnostics
  const [logsVisible, setLogsVisible] = useState(false);

  // TTS
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [ttsVoice, setTtsVoiceState] = useState<string | null>(null);
  const [ttsRate, setTtsRateState] = useState(0.95);
  const [ttsProvider, setTtsProviderState] = useState<TtsProvider>('volcano');
  const [volcVoice, setVolcVoiceState] = useState(DEFAULT_VOLCANO_VOICE);
  const [sampling, setSampling] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [settings, models, storedKeys, reminderSettings, englishVoices, tts, hideM] = await Promise.all([
      getSettings(),
      getDownloadedModels(),
      getApiKeys(),
      getReminderSettings(),
      getEnglishVoices().catch(() => [] as TtsVoice[]),
      getTtsSettings(),
      getHideMeaning(),
    ]);
    setEngine(settings.transcriptionEngine);
    setActiveModel(settings.whisperModel);
    setMirror(settings.modelMirror);
    setAiProviderState(settings.aiProvider);
    setAiEnabledState(settings.aiEnabled);
    setHideMeaningState(hideM);
    setDownloaded(models);
    setReminderState(reminderSettings);
    setVoices(englishVoices);
    setTtsVoiceState(tts.voice);
    setTtsRateState(tts.rate);
    setTtsProviderState(tts.provider);
    setVolcVoiceState(tts.volcanoVoice);
    setKeys(storedKeys);
  }, []);

  useEffect(() => {
    if (visible) {
      setPage('home');
      void refresh();
    }
  }, [visible, refresh]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  // Auto-save: merge the one changed key into secure storage immediately.
  const saveKey = useCallback(async (field: keyof ApiKeys, value: string) => {
    const next = { ...keys, [field]: value.trim() };
    setKeys(next);
    try {
      await saveApiKeys(next);
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '无法保存 API Key');
    }
  }, [keys]);

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
      Alert.alert('下载失败', e instanceof Error ? e.message : '无法下载模型,请检查网络或切换下载源');
    } finally {
      setDownloading(prev => {
        const next = { ...prev };
        delete next[model];
        return next;
      });
    }
  };

  const handleDeleteModel = (model: WhisperModelName) => {
    Alert.alert('删除模型', '之后可以随时重新下载。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          await releaseWhisperContext();
          await deleteModel(model);
          setDownloaded(prev => prev.filter(m => m !== model));
        },
      },
    ]);
  };

  const handleMirror = async (next: ModelMirror) => {
    setMirror(next);
    await setModelMirror(next);
  };

  const handleHideMeaning = async (v: boolean) => {
    setHideMeaningState(v);
    await setHideMeaning(v);
  };

  const handleAiEnabled = async (v: boolean) => {
    setAiEnabledState(v);
    await setAiEnabled(v);
  };

  const handleAiProvider = async (next: AiProvider) => {
    setAiProviderState(next);
    await setAiProvider(next);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportBackup();
    } catch (e) {
      Alert.alert('导出失败', e instanceof Error ? e.message : '无法创建备份');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const summary = await importBackup();
      if (summary) {
        await Promise.all([
          useLibraryStore.getState().loadItems(),
          useAudioFilesStore.getState().loadAudioFiles(),
          useAudioFilesStore.getState().loadCategories(),
        ]);
        Alert.alert(
          '导入完成',
          `恢复了 ${summary.savedItemsAdded} 条短语` +
          (summary.savedItemsSkipped > 0 ? `(${summary.savedItemsSkipped} 条已存在,自动跳过)` : '') +
          (summary.categoriesAdded > 0 ? `\n新增 ${summary.categoriesAdded} 个分类` : '') +
          (summary.audioFilesAdded > 0 ? `\n恢复了 ${summary.audioFilesAdded} 个文件条目 — 重新导入对应音频后可继续收听` : '')
        );
      }
    } catch (e) {
      Alert.alert('导入失败', e instanceof Error ? e.message : '无法读取备份文件');
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
      Alert.alert('提醒未设置', e instanceof Error ? e.message : '无法设置提醒');
    }
  };

  const handleTtsProvider = async (next: TtsProvider) => {
    setTtsProviderState(next);
    await setTtsProvider(next);
  };

  const handleTtsVoice = async (identifier: string | null) => {
    setTtsVoiceState(identifier);
    await setTtsVoice(identifier);
    speakSample(identifier, ttsRate);
  };

  const handleVolcanoVoice = async (voiceType: string) => {
    setVolcVoiceState(voiceType);
    await setVolcanoVoice(voiceType);
    setSampling(voiceType);
    try {
      await speakVolcanoSample(voiceType, ttsRate);
    } catch (e) {
      Alert.alert('试听失败', e instanceof Error ? e.message : '无法合成示例语音');
    } finally {
      setSampling(null);
    }
  };

  const handleTtsRate = async (rate: number) => {
    setTtsRateState(rate);
    await setTtsRate(rate);
    if (ttsProvider === 'system') speakSample(ttsVoice, rate);
  };

  // ── Hub status lines ────────────────────────────────────────────────────────

  const offlineReady = LOCAL_SUPPORTED && downloaded.includes(activeModel);
  const cloudReady = keys.volcApiKey.trim().length > 0;

  const engineStatus: { text: string; tone: Tone } =
    engine === 'local'
      ? offlineReady
        ? { text: '离线 · 已就绪', tone: 'ok' }
        : LOCAL_SUPPORTED
          ? { text: '离线 · 还差 1 步:下载模型', tone: 'warn' }
          : { text: '离线 · 需要正式安装版', tone: 'warn' }
      : cloudReady
        ? { text: '云端(火山引擎) · 已就绪', tone: 'ok' }
        : { text: '云端 · 还差 1 步:填 API Key', tone: 'warn' };

  const volcVoiceLabel = VOLCANO_VOICES.find(v => v.id === volcVoice)?.label ?? '豆包语音';
  const ttsStatus: { text: string; tone: Tone } =
    ttsProvider === 'volcano'
      ? cloudReady
        ? { text: `豆包语音 · ${volcVoiceLabel}`, tone: 'ok' }
        : { text: '豆包语音 · 需 API Key(暂用系统语音)', tone: 'warn' }
      : { text: '系统语音 · 完全离线', tone: 'ok' };

  const aiKey = aiProvider === 'volcano' ? keys.arkApiKey : keys.deepseekApiKey;
  const aiStatus: { text: string; tone: Tone } = !aiEnabled
    ? { text: '已关闭', tone: 'muted' }
    : aiKey.trim()
      ? { text: `${aiProvider === 'volcano' ? '豆包' : 'DeepSeek'} · 已就绪`, tone: 'ok' }
      : { text: '还差 1 步:填 API Key', tone: 'warn' };

  // ── Render ──────────────────────────────────────────────────────────────────

  const handleBack = () => setPage('home');
  const handleRequestClose = () => {
    if (page !== 'home') handleBack();
    else onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleRequestClose}>
      {/* Keep the header clear of the status bar (Android edge-to-edge) */}
      <View style={[styles.modal, { paddingTop: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.modalHeader}>
          {page !== 'home' && (
            <Pressable onPress={handleBack} hitSlop={8} style={{ marginRight: 10 }}>
              <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
            </Pressable>
          )}
          <Text style={styles.modalTitle}>{PAGE_TITLES[page]}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={COLORS.text} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {page === 'home' && (
            <>
              <HubRow
                icon="mic-outline"
                title="转写引擎"
                status={engineStatus.text}
                tone={engineStatus.tone}
                onPress={() => setPage('engine')}
              />
              <HubRow
                icon="volume-high-outline"
                title="发音朗读"
                status={ttsStatus.text}
                tone={ttsStatus.tone}
                onPress={() => setPage('tts')}
              />
              <HubRow
                icon="sparkles-outline"
                title="AI 学习笔记"
                status={aiStatus.text}
                tone={aiStatus.tone}
                onPress={() => setPage('ai')}
              />

              {/* 每日提醒:简单项,直接内联 */}
              <View style={styles.reminderRow}>
                <View style={styles.reminderIcon}>
                  <Ionicons name="alarm-outline" size={20} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reminderTitle}>每日复习提醒</Text>
                  <Text style={styles.reminderSubtitle}>
                    {remindersSupported
                      ? '本地通知,完全离线'
                      : '需要正式安装版 App(Expo Go 不支持)'}
                  </Text>
                </View>
                <Switch
                  value={reminder.enabled}
                  disabled={!remindersSupported}
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

              <HubRow
                icon="server-outline"
                title="数据与存储"
                status="备份 · 导入 · 存储空间"
                tone="muted"
                onPress={() => setPage('data')}
              />

              <HubRow
                icon="cloud-download-outline"
                title="应用更新"
                status="查看版本 · 检查热更新"
                tone="muted"
                onPress={() => setPage('updates')}
              />

              <HubRow
                icon="terminal-outline"
                title="运行日志"
                status="排查问题时使用 · 可分享给开发者"
                tone="muted"
                onPress={() => setLogsVisible(true)}
              />

              <Text style={styles.footerNote}>所有 Key 与数据只保存在本机。</Text>
            </>
          )}

          {page === 'engine' && (
            <EnginePage
              localSupported={LOCAL_SUPPORTED}
              engine={engine}
              onEngine={handleEngine}
              downloaded={downloaded}
              activeModel={activeModel}
              downloading={downloading}
              onDownload={handleDownload}
              onDeleteModel={handleDeleteModel}
              onSelectModel={handleSelectModel}
              mirror={mirror}
              onMirror={handleMirror}
              volcKey={keys.volcApiKey}
              onSaveVolcKey={v => saveKey('volcApiKey', v)}
            />
          )}

          {page === 'tts' && (
            <TtsPage
              provider={ttsProvider}
              onProvider={handleTtsProvider}
              volcKey={keys.volcApiKey}
              onSaveVolcKey={v => saveKey('volcApiKey', v)}
              rate={ttsRate}
              onRate={handleTtsRate}
              voices={voices}
              voice={ttsVoice}
              onVoice={handleTtsVoice}
              volcVoice={volcVoice}
              onVolcVoice={handleVolcanoVoice}
              sampling={sampling}
            />
          )}

          {page === 'ai' && (
            <AiPage
              enabled={aiEnabled}
              onEnabled={handleAiEnabled}
              provider={aiProvider}
              onProvider={handleAiProvider}
              arkKey={keys.arkApiKey}
              onSaveArkKey={v => saveKey('arkApiKey', v)}
              deepseekKey={keys.deepseekApiKey}
              onSaveDeepseekKey={v => saveKey('deepseekApiKey', v)}
              hideMeaning={hideMeaning}
              onHideMeaning={handleHideMeaning}
            />
          )}

          {page === 'data' && (
            <DataPage
              exporting={exporting}
              importing={importing}
              onExport={handleExport}
              onImport={handleImport}
            />
          )}

          {page === 'updates' && <UpdatesPage />}
        </ScrollView>

        <LogViewerModal visible={logsVisible} onClose={() => setLogsVisible(false)} />
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  modal:           { flex: 1, padding: 24, backgroundColor: COLORS.background },
  modalHeader:     { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  modalTitle:      { fontSize: 20, fontWeight: '700', color: COLORS.text },

  reminderRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10 },
  reminderIcon:    { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  reminderTitle:   { fontSize: 15, fontWeight: '600', color: COLORS.text },
  reminderSubtitle:{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  timeRow:         { flexDirection: 'row', gap: 8, marginBottom: 10, marginTop: -2, paddingLeft: 50 },
  timeChip:        { borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  timeChipActive:  { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  timeChipText:    { fontSize: 12, color: COLORS.textSecondary, fontWeight: '600' },
  timeChipTextActive: { color: COLORS.primary },

  footerNote:      { fontSize: 12, color: COLORS.textSecondary, textAlign: 'center', marginTop: 16 },
});
