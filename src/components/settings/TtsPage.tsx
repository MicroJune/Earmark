import React, { useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../constants/colors';
import { useTheme } from '../../theme/ThemeProvider';
import type { TtsVoice, TtsProvider } from '../../services/tts';
import { VOLCANO_VOICES } from '../../services/volcano';
import { PageIntro, SectionTitle, Hint, Segmented, KeyInput } from './ui';

// ─── 发音朗读页 ────────────────────────────────────────────────────────────────

interface Props {
  provider: TtsProvider;
  onProvider: (p: TtsProvider) => void;
  volcKey: string;
  onSaveVolcKey: (v: string) => void;
  rate: number;
  onRate: (r: number) => void;
  voices: TtsVoice[];           // system voices
  voice: string | null;         // selected system voice
  onVoice: (id: string | null) => void;
  volcVoice: string;            // selected volcano voice
  onVolcVoice: (id: string) => void;
  sampling: string | null;      // volcano voice id currently synthesizing a sample
}

export default function TtsPage({
  provider, onProvider, volcKey, onSaveVolcKey,
  rate, onRate, voices, voice, onVoice, volcVoice, onVolcVoice, sampling,
}: Props) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const hasVolcKey = volcKey.trim().length > 0;

  return (
    <View>
      <PageIntro>朗读单词和例句时用的声音。点击任意音色即可试听并选用。</PageIntro>

      <SectionTitle>语音引擎</SectionTitle>
      <Segmented<TtsProvider>
        options={[
          { label: '豆包语音(更清晰)', value: 'volcano' },
          { label: '系统语音(离线)', value: 'system' },
        ]}
        value={provider}
        onChange={onProvider}
      />

      {provider === 'volcano' && (
        <>
          <Hint>
            词典级音质。每段文字只联网合成一次,之后离线可重放;网络不可用时自动改用系统语音,朗读永远可用。
          </Hint>
          {hasVolcKey ? (
            <View style={styles.keyOkRow}>
              <Ionicons name="checkmark-circle" size={16} color={c.success} />
              <Text style={styles.keyOkText}>已配置火山引擎 Key(与云端转写共用,无需重复填写)</Text>
            </View>
          ) : (
            <KeyInput
              label="火山引擎语音 API Key(与云端转写共用一个)"
              placeholder="粘贴 API Key,输入完自动保存"
              value={volcKey}
              onSave={onSaveVolcKey}
              hint="获取方式:console.volcengine.com/speech/app 创建应用并开通「语音合成大模型」。"
            />
          )}
        </>
      )}

      <SectionTitle>朗读速度</SectionTitle>
      <Segmented
        options={[
          { label: '慢 0.75×', value: '0.75' },
          { label: '标准 0.95×', value: '0.95' },
          { label: '快 1.1×', value: '1.1' },
        ]}
        value={String(rate)}
        onChange={v => onRate(Number(v))}
      />

      <SectionTitle>音色(点击试听并选用)</SectionTitle>
      {provider === 'volcano' ? (
        VOLCANO_VOICES.map(v => (
          <Pressable
            key={v.id}
            style={[styles.voiceRow, volcVoice === v.id && styles.voiceRowActive]}
            onPress={() => onVolcVoice(v.id)}
          >
            {sampling === v.id
              ? <ActivityIndicator size="small" color={c.primary} />
              : <Ionicons name="volume-medium-outline" size={16} color={c.primary} />}
            <Text style={[styles.voiceName, { flex: 1 }]}>{v.label}</Text>
            {volcVoice === v.id && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
          </Pressable>
        ))
      ) : (
        <>
          <Pressable
            style={[styles.voiceRow, voice === null && styles.voiceRowActive]}
            onPress={() => onVoice(null)}
          >
            <Ionicons name="volume-medium-outline" size={16} color={c.primary} />
            <Text style={[styles.voiceName, { flex: 1 }]}>系统默认</Text>
            {voice === null && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
          </Pressable>
          {voices.slice(0, 12).map(v => (
            <Pressable
              key={v.identifier}
              style={[styles.voiceRow, voice === v.identifier && styles.voiceRowActive]}
              onPress={() => onVoice(v.identifier)}
            >
              <Ionicons name="volume-medium-outline" size={16} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.voiceName} numberOfLines={1}>{v.name}</Text>
                <Text style={styles.voiceMeta}>
                  {v.language}{v.enhanced ? ' · 增强版' : ''}
                </Text>
              </View>
              {voice === v.identifier && <Ionicons name="checkmark-circle" size={18} color={c.primary} />}
            </Pressable>
          ))}
          {voices.length <= 1 && (
            <Hint>
              发音不清晰?安装「Google 文字转语音」(Speech Services by Google)后,在手机
              设置 → 系统 → 语言和输入 → 文字转语音 中切换引擎并下载英文离线语音包,
              然后回这里选择新音色 — 下载后完全离线可用。
            </Hint>
          )}
        </>
      )}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
  keyOkRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.success + '14', borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 4 },
  keyOkText: { flex: 1, fontSize: 12, color: c.text, lineHeight: 17 },

  voiceRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6, borderWidth: 1.5, borderColor: 'transparent' },
  voiceRowActive: { borderColor: c.primary },
  voiceName:      { fontSize: 13, fontWeight: '600', color: c.text },
  voiceMeta:      { fontSize: 11, color: c.textSecondary, marginTop: 1 },
  });
}
