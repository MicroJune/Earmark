import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';

// ─── Shared building blocks for the Settings pages ────────────────────────────

export type Tone = 'ok' | 'warn' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  ok: COLORS.success,
  warn: COLORS.warning,
  muted: COLORS.textSecondary,
};

/** Small status pill: "✓ 已就绪" / "⚠ 还差 1 步:…" */
export function StatusBadge({ tone, text }: { tone: Tone; text: string }) {
  return (
    <View style={[ui.badge, { backgroundColor: TONE_COLOR[tone] + '1A' }]}>
      <Ionicons
        name={tone === 'ok' ? 'checkmark-circle' : tone === 'warn' ? 'alert-circle' : 'ellipse-outline'}
        size={13}
        color={TONE_COLOR[tone]}
      />
      <Text style={[ui.badgeText, { color: TONE_COLOR[tone] }]}>{text}</Text>
    </View>
  );
}

/** One row on the Settings hub: icon + title + status line + chevron. */
export function HubRow({
  icon, title, status, tone, onPress,
}: {
  icon: string; title: string; status: string; tone: Tone; onPress: () => void;
}) {
  return (
    <Pressable style={ui.hubRow} onPress={onPress}>
      <View style={ui.hubIcon}>
        <Ionicons name={icon as any} size={20} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ui.hubTitle}>{title}</Text>
        <Text style={[ui.hubStatus, { color: TONE_COLOR[tone] }]}>{status}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
    </Pressable>
  );
}

/** Page intro — one plain-language sentence about what this page configures. */
export function PageIntro({ children }: { children: string }) {
  return <Text style={ui.intro}>{children}</Text>;
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={ui.sectionTitle}>{children}</Text>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={ui.hint}>{children}</Text>;
}

/** Two-to-three option segmented control. */
export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={ui.segmentRow}>
      {options.map(o => (
        <Pressable
          key={o.value}
          style={[ui.segmentBtn, value === o.value && ui.segmentBtnActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[ui.segmentText, value === o.value && ui.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * API Key input that saves itself when the user finishes typing (blur/submit).
 * Shows a transient "已自动保存" confirmation — no global Save button needed.
 */
export function KeyInput({
  label, placeholder, value, onSave, hint,
}: {
  label: string;
  placeholder: string;
  value: string;
  onSave: (v: string) => void | Promise<void>;
  hint?: string;
}) {
  const [text, setText] = useState(value);
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setText(value); }, [value]);

  const commit = () => {
    if (text.trim() === value.trim()) return;
    void onSave(text.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={ui.label}>{label}</Text>
      <View style={ui.keyRow}>
        <TextInput
          style={ui.keyInput}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textSecondary}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
        />
        <Pressable onPress={() => setShow(s => !s)} hitSlop={8} style={ui.eyeBtn}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.textSecondary} />
        </Pressable>
      </View>
      {saved && <Text style={ui.savedNote}>✓ 已自动保存</Text>}
      {hint ? <Text style={ui.hint}>{hint}</Text> : null}
    </View>
  );
}

export const ui = StyleSheet.create({
  badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  badgeText:    { fontSize: 12, fontWeight: '600' },

  hubRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: COLORS.surface, borderRadius: 14, padding: 16, marginBottom: 10 },
  hubIcon:      { width: 38, height: 38, borderRadius: 10, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  hubTitle:     { fontSize: 15, fontWeight: '600', color: COLORS.text },
  hubStatus:    { fontSize: 12, marginTop: 2, fontWeight: '500' },

  intro:        { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginTop: 18, marginBottom: 8 },
  hint:         { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18, marginTop: 6 },
  label:        { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 6 },

  segmentRow:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segmentBtn:   { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: 'center' },
  segmentBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  segmentText:  { fontSize: 13, fontWeight: '600', color: COLORS.textSecondary },
  segmentTextActive: { color: COLORS.primary },

  keyRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: COLORS.surface },
  keyInput:     { flex: 1, padding: 12, fontSize: 14, color: COLORS.text },
  eyeBtn:       { paddingHorizontal: 12 },
  savedNote:    { fontSize: 12, color: COLORS.success, marginTop: 4, fontWeight: '600' },
});
