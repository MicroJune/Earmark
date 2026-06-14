import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../constants/colors';
import { useTheme } from '../../theme/ThemeProvider';
import { PageIntro } from './ui';
import StorageModal from '../StorageModal';

// ─── 数据与存储页 ──────────────────────────────────────────────────────────────

interface Props {
  exporting: boolean;
  importing: boolean;
  onExport: () => void;
  onImport: () => void;
}

function DataRow({
  icon, title, subtitle, busy, chevron, onPress,
}: {
  icon: string; title: string; subtitle: string;
  busy?: boolean; chevron?: boolean; onPress: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={busy}>
      {busy
        ? <ActivityIndicator size="small" color={c.primary} />
        : <Ionicons name={icon as any} size={18} color={c.primary} />}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      {chevron && <Ionicons name="chevron-forward" size={16} color={c.textSecondary} />}
    </Pressable>
  );
}

export default function DataPage({ exporting, importing, onExport, onImport }: Props) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [storageVisible, setStorageVisible] = useState(false);

  return (
    <View>
      <PageIntro>
        学习数据(短语、分类、复习记录、转写文本)只保存在这台手机上 — 建议定期导出备份,防止换机或误删丢失。备份文件不含音频本体,所以体积小、好传输。
      </PageIntro>

      <DataRow
        icon="download-outline"
        title="导出备份"
        subtitle="生成一个 JSON 文件(含转写,不含音频),可存到网盘 / 微信文件传输助手"
        busy={exporting}
        onPress={onExport}
      />
      <DataRow
        icon="push-outline"
        title="导入备份"
        subtitle="合并备份文件 — 自动去重,重复导入不会产生重复数据"
        busy={importing}
        onPress={onImport}
      />

      <Text style={styles.migrateHint}>
        换新手机:先在新机「导入备份」,单词、笔记、复习进度、转写会全部恢复;再把原音频文件重新导入(同名即可),即可自动重连,无需重新转写,原音播放和跟读照常使用。
      </Text>
      <DataRow
        icon="server-outline"
        title="存储空间管理"
        subtitle="查看占用;删除音频可保留学习卡片"
        chevron
        onPress={() => setStorageVisible(true)}
      />

      <StorageModal visible={storageVisible} onClose={() => setStorageVisible(false)} />
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  rowTitle:    { fontSize: 14, fontWeight: '600', color: c.text },
  rowSubtitle: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  migrateHint: { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 12, paddingHorizontal: 2 },
  });
}
