import React, { useState } from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { WHISPER_MODELS } from '../../services/transcription/models';
import type { TranscriptionEngine, WhisperModelName, ModelMirror } from '../../services/settings';
import { StatusBadge, PageIntro, SectionTitle, Hint, Segmented, KeyInput } from './ui';

// ─── 转写引擎页 ────────────────────────────────────────────────────────────────
// 两种模式严格二选一,只显示当前模式需要的配置,每种模式带"就绪"状态。

const RECOMMENDED_MODEL: WhisperModelName = 'base.en';

interface Props {
  localSupported: boolean;
  engine: TranscriptionEngine;
  onEngine: (e: TranscriptionEngine) => void;
  downloaded: WhisperModelName[];
  activeModel: WhisperModelName;
  downloading: Partial<Record<WhisperModelName, number>>;
  onDownload: (m: WhisperModelName) => void;
  onDeleteModel: (m: WhisperModelName) => void;
  onSelectModel: (m: WhisperModelName) => void;
  mirror: ModelMirror;
  onMirror: (m: ModelMirror) => void;
  volcKey: string;
  onSaveVolcKey: (v: string) => void;
}

function ModeCard({
  icon, title, subtitle, active, disabled, badgeTone, badgeText, onPress,
}: {
  icon: string; title: string; subtitle: string;
  active: boolean; disabled?: boolean;
  badgeTone: 'ok' | 'warn' | 'muted'; badgeText: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.modeCard, active && styles.modeCardActive, disabled && { opacity: 0.55 }]}
      onPress={onPress}
    >
      <View style={styles.modeHeader}>
        <Ionicons name={icon as any} size={22} color={active ? COLORS.primary : COLORS.textSecondary} />
        <Text style={[styles.modeTitle, active && { color: COLORS.primary }]}>{title}</Text>
        {active && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
      </View>
      <Text style={styles.modeSubtitle}>{subtitle}</Text>
      <StatusBadge tone={badgeTone} text={badgeText} />
    </Pressable>
  );
}

export default function EnginePage({
  localSupported, engine, onEngine,
  downloaded, activeModel, downloading, onDownload, onDeleteModel, onSelectModel,
  mirror, onMirror, volcKey, onSaveVolcKey,
}: Props) {
  const [advanced, setAdvanced] = useState(false);

  const offlineReady = localSupported && downloaded.includes(activeModel);
  const cloudReady = volcKey.trim().length > 0;
  const recommended = WHISPER_MODELS.find(m => m.name === RECOMMENDED_MODEL)!;
  const recommendedDownloaded = downloaded.includes(RECOMMENDED_MODEL);
  const recommendedProgress = downloading[RECOMMENDED_MODEL] ?? null;

  const handleOfflinePress = () => {
    if (!localSupported) {
      Alert.alert(
        '需要正式安装版',
        '离线转写使用手机本地的语音模型,Expo Go 预览环境不包含这部分原生代码。' +
        '安装正式构建的 App 后即可使用(见 OFFLINE_SETUP.md)。当前请先使用云端转写。'
      );
      return;
    }
    onEngine('local');
  };

  return (
    <View>
      <PageIntro>把音频转成文字。两种方式二选一,按卡片提示完成配置即可使用。</PageIntro>

      <ModeCard
        icon="phone-portrait-outline"
        title="离线转写(推荐)"
        subtitle="免费 · 无需网络 · 音频不离开手机"
        active={engine === 'local'}
        disabled={!localSupported}
        badgeTone={!localSupported ? 'muted' : offlineReady ? 'ok' : 'warn'}
        badgeText={
          !localSupported ? '需要正式安装版 App(Expo Go 不支持)'
          : offlineReady ? '已就绪,完全离线可用'
          : '还差 1 步:下载语音模型'
        }
        onPress={handleOfflinePress}
      />

      <ModeCard
        icon="cloud-outline"
        title="云端转写(火山引擎)"
        subtitle="速度快 · 需要网络和 API Key · 单文件 100 MB 内"
        active={engine === 'cloud'}
        badgeTone={cloudReady ? 'ok' : 'warn'}
        badgeText={cloudReady ? '已就绪' : '还差 1 步:填写 API Key'}
        onPress={() => onEngine('cloud')}
      />

      {/* ── 离线模式的配置:只在选中离线时显示 ─────────────────────────── */}
      {engine === 'local' && localSupported && (
        <>
          <SectionTitle>① 下载语音模型(一次性)</SectionTitle>
          <View style={styles.recommendRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recommendName}>
                {recommended.label} <Text style={styles.recommendTag}>推荐</Text>
              </Text>
              <Text style={styles.recommendDesc}>
                {recommendedDownloaded
                  ? `已下载 · ${recommended.sizeMB} MB`
                  : `${recommended.sizeMB} MB,建议在 Wi-Fi 下下载,之后永久离线可用`}
              </Text>
              {recommendedProgress !== null && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.round(recommendedProgress * 100)}%` }]} />
                </View>
              )}
            </View>
            {recommendedProgress !== null ? (
              <Text style={styles.progressPct}>{Math.round(recommendedProgress * 100)}%</Text>
            ) : recommendedDownloaded ? (
              activeModel === RECOMMENDED_MODEL ? (
                <Ionicons name="checkmark-circle" size={22} color={COLORS.success} />
              ) : (
                <Pressable style={styles.useBtn} onPress={() => onSelectModel(RECOMMENDED_MODEL)}>
                  <Text style={styles.useBtnText}>使用</Text>
                </Pressable>
              )
            ) : (
              <Pressable style={styles.downloadBtn} onPress={() => onDownload(RECOMMENDED_MODEL)}>
                <Ionicons name="cloud-download-outline" size={16} color="#fff" />
                <Text style={styles.downloadBtnText}>下载</Text>
              </Pressable>
            )}
          </View>
          {!recommendedDownloaded && (
            <Hint>中国大陆用户下载卡住时,请到下方「高级选项」切换为国内镜像。</Hint>
          )}

          <Pressable style={styles.advancedToggle} onPress={() => setAdvanced(a => !a)}>
            <Text style={styles.advancedToggleText}>高级选项</Text>
            <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
          </Pressable>

          {advanced && (
            <>
              <SectionTitle>所有模型(越大越准,越慢)</SectionTitle>
              {WHISPER_MODELS.map(m => {
                const isDownloaded = downloaded.includes(m.name);
                const progress = downloading[m.name] ?? null;
                return (
                  <Pressable
                    key={m.name}
                    style={[styles.modelRow, activeModel === m.name && isDownloaded && styles.modelRowActive]}
                    onPress={isDownloaded ? () => onSelectModel(m.name) : undefined}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recommendName}>{m.label}</Text>
                      <Text style={styles.recommendDesc}>{m.description}</Text>
                      {progress !== null ? (
                        <View style={styles.progressTrack}>
                          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                        </View>
                      ) : (
                        <Text style={styles.modelSize}>
                          {isDownloaded ? `已下载 · ${m.sizeMB} MB` : `${m.sizeMB} MB`}
                        </Text>
                      )}
                    </View>
                    {progress !== null ? (
                      <Text style={styles.progressPct}>{Math.round(progress * 100)}%</Text>
                    ) : isDownloaded ? (
                      <View style={styles.modelActions}>
                        {activeModel === m.name && <Ionicons name="checkmark-circle" size={20} color={COLORS.primary} />}
                        <Pressable onPress={() => onDeleteModel(m.name)} hitSlop={8}>
                          <Ionicons name="trash-outline" size={17} color={COLORS.textSecondary} />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable style={styles.downloadBtn} onPress={() => onDownload(m.name)}>
                        <Ionicons name="cloud-download-outline" size={15} color="#fff" />
                        <Text style={styles.downloadBtnText}>下载</Text>
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}

              <SectionTitle>下载源</SectionTitle>
              <Segmented<ModelMirror>
                options={[
                  { label: 'Hugging Face', value: 'huggingface' },
                  { label: '国内镜像', value: 'hf-mirror' },
                ]}
                value={mirror}
                onChange={onMirror}
              />
              <Hint>只影响一次性的模型下载,中国大陆用户请选「国内镜像」。</Hint>
            </>
          )}
        </>
      )}

      {/* ── 云端模式的配置:只在选中云端时显示 ─────────────────────────── */}
      {engine === 'cloud' && (
        <>
          <SectionTitle>① 填写火山引擎语音 API Key</SectionTitle>
          <KeyInput
            label="火山引擎语音 API Key(同时用于豆包朗读)"
            placeholder="粘贴 API Key,输入完自动保存"
            value={volcKey}
            onSave={onSaveVolcKey}
            hint={'获取方式:打开 console.volcengine.com/speech/app 创建应用,开通「大模型录音文件识别」和「语音合成大模型」,复制该应用的 API Key 粘贴到上面。有免费额度,个人使用基本够用。'}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modeCard:       { backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1.5, borderColor: 'transparent' },
  modeCardActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  modeHeader:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeTitle:      { flex: 1, fontSize: 15, fontWeight: '700', color: COLORS.text },
  modeSubtitle:   { fontSize: 12, color: COLORS.textSecondary, marginTop: 6 },

  recommendRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14 },
  recommendName:  { fontSize: 14, fontWeight: '600', color: COLORS.text },
  recommendTag:   { fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  recommendDesc:  { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },

  modelRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1.5, borderColor: 'transparent' },
  modelRowActive: { borderColor: COLORS.primary },
  modelSize:      { fontSize: 11, color: COLORS.textSecondary, marginTop: 4 },
  modelActions:   { flexDirection: 'row', alignItems: 'center', gap: 10 },

  downloadBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  downloadBtnText:{ color: '#fff', fontSize: 13, fontWeight: '600' },
  useBtn:         { borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  useBtnText:     { color: COLORS.primary, fontSize: 13, fontWeight: '600' },

  progressTrack:  { height: 4, backgroundColor: COLORS.border, borderRadius: 2, marginTop: 8 },
  progressFill:   { height: 4, backgroundColor: COLORS.primary, borderRadius: 2 },
  progressPct:    { fontSize: 12, fontWeight: '600', color: COLORS.primary, width: 40, textAlign: 'right' },

  advancedToggle:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 12, marginTop: 4 },
  advancedToggleText: { fontSize: 13, color: COLORS.textSecondary, fontWeight: '600' },
});
