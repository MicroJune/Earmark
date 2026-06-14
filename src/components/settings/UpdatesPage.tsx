import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../constants/colors';
import { useTheme } from '../../theme/ThemeProvider';
import { PageIntro, SectionTitle, StatusBadge, type Tone } from './ui';
import { getUpdateInfo, checkForUpdate, reloadApp, type CheckResult } from '../../services/updates';

function shortId(id: string | null): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const RESULT_BADGE: Record<Exclude<CheckResult['status'], 'error'>, { tone: Tone; text: string }> = {
  disabled:     { tone: 'muted', text: '当前环境不支持热更新' },
  'up-to-date': { tone: 'ok',    text: '已是最新版本' },
  downloaded:   { tone: 'ok',    text: '新版本已下载,可立即重启' },
};

export default function UpdatesPage() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [info] = useState(getUpdateInfo);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);

  const onCheck = async () => {
    setChecking(true);
    setResult(null);
    setResult(await checkForUpdate());
    setChecking(false);
  };

  return (
    <View>
      <PageIntro>
        应用通过 EAS Update 推送热更新(只更新 JS,无需重新安装)。每次冷启动会自动检查;也可以在这里手动检查并立即重启。
      </PageIntro>

      <SectionTitle>当前运行的版本</SectionTitle>
      <View style={styles.card}>
        <InfoRow label="来源" value={info.isEmbedded ? '内置版本(未应用热更新)' : '热更新(OTA)'} />
        <InfoRow label="版本(runtimeVersion)" value={info.runtimeVersion ?? '—'} />
        <InfoRow label="渠道(channel)" value={info.channel ?? '—'} />
        <InfoRow label="更新 ID" value={shortId(info.updateId)} />
        <InfoRow
          label="发布时间"
          value={info.createdAt ? info.createdAt.toLocaleString() : '—'}
        />
      </View>

      {!info.enabled && (
        <Text style={styles.note}>
          当前是开发版 / Expo Go,热更新未启用 —— 在正式的 preview / production 构建里才会生效。
        </Text>
      )}

      <SectionTitle>检查更新</SectionTitle>
      <Pressable
        style={[styles.checkBtn, (!info.enabled || checking) && styles.checkBtnDisabled]}
        onPress={onCheck}
        disabled={!info.enabled || checking}
      >
        {checking
          ? <ActivityIndicator size="small" color="#fff" />
          : <Ionicons name="cloud-download-outline" size={18} color="#fff" />}
        <Text style={styles.checkBtnText}>{checking ? '正在检查…' : '检查更新'}</Text>
      </Pressable>

      {result && result.status === 'error' && (
        <View style={{ marginTop: 10 }}>
          <StatusBadge tone="warn" text="检查失败" />
          <Text style={styles.errText}>{result.message}</Text>
        </View>
      )}
      {result && result.status !== 'error' && (
        <View style={{ marginTop: 10 }}>
          <StatusBadge tone={RESULT_BADGE[result.status].tone} text={RESULT_BADGE[result.status].text} />
        </View>
      )}

      {result?.status === 'downloaded' && (
        <Pressable style={styles.reloadBtn} onPress={() => { void reloadApp(); }}>
          <Ionicons name="refresh" size={18} color={c.primary} />
          <Text style={styles.reloadBtnText}>立即重启应用</Text>
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
  card:        { backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 6 },
  infoRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 12 },
  infoLabel:   { fontSize: 13, color: c.textSecondary },
  infoValue:   { fontSize: 13, color: c.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },

  note:        { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 10 },

  checkBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.primary, borderRadius: 12, paddingVertical: 14 },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  errText:      { fontSize: 12, color: c.textSecondary, marginTop: 6, lineHeight: 18 },

  reloadBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: c.primary, borderRadius: 12, paddingVertical: 12, marginTop: 12 },
  reloadBtnText: { color: c.primary, fontSize: 15, fontWeight: '700' },
  });
}
