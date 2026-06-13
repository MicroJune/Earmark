import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { COLORS } from '../../constants/colors';
import type { AiProvider } from '../../services/settings';
import { PageIntro, SectionTitle, Hint, Segmented, KeyInput } from './ui';

// ─── AI 学习笔记页 ─────────────────────────────────────────────────────────────
// 总开关在最上面:关闭时整页只有一句解释,零配置压力。

interface Props {
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  provider: AiProvider;
  onProvider: (p: AiProvider) => void;
  arkKey: string;
  onSaveArkKey: (v: string) => void;
  deepseekKey: string;
  onSaveDeepseekKey: (v: string) => void;
}

export default function AiPage({
  enabled, onEnabled, provider, onProvider,
  arkKey, onSaveArkKey, deepseekKey, onSaveDeepseekKey,
}: Props) {
  return (
    <View>
      <PageIntro>
        保存短语时自动生成中文翻译、近义词、例句和用法提示(需联网,生成一次永久离线可看)。这是可选功能 — 转写、词典、复习全部不依赖它。
      </PageIntro>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchTitle}>启用 AI 学习笔记</Text>
          <Text style={styles.switchSubtitle}>关闭后仍可在单词详情页手动生成</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onEnabled}
          trackColor={{ true: COLORS.primary }}
        />
      </View>

      {enabled && (
        <>
          <SectionTitle>① 选择 AI 服务商</SectionTitle>
          <Segmented<AiProvider>
            options={[
              { label: '豆包(火山方舟)', value: 'volcano' },
              { label: 'DeepSeek', value: 'deepseek' },
            ]}
            value={provider}
            onChange={onProvider}
          />

          <SectionTitle>② 填写对应的 API Key</SectionTitle>
          {provider === 'volcano' ? (
            <KeyInput
              label="火山方舟 API Key"
              placeholder="粘贴方舟 API Key,输入完自动保存"
              value={arkKey}
              onSave={onSaveArkKey}
              hint={'注意:方舟和「语音」是两套独立的 Key,转写页填的语音 Key 在这里不能用。获取方式:console.volcengine.com/ark → API Key 管理 创建,并在「开通管理」里开通 Doubao-Seed-1.6-flash 模型。'}
            />
          ) : (
            <KeyInput
              label="DeepSeek API Key"
              placeholder="sk-…,输入完自动保存"
              value={deepseekKey}
              onSave={onSaveDeepseekKey}
              hint="在 platform.deepseek.com 注册(支持手机号 + 微信/支付宝),充值几元即可用很久。"
            />
          )}

          <Hint>Key 只保存在你的手机上,不会上传到任何服务器。</Hint>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 12, padding: 14 },
  switchTitle:    { fontSize: 14, fontWeight: '600', color: COLORS.text },
  switchSubtitle: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
});
