import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../../constants/colors';
import { useTheme } from '../../theme/ThemeProvider';

// ─── Shared building blocks for the Settings pages ────────────────────────────

export type Tone = 'ok' | 'warn' | 'muted';

function toneColor(c: Palette, tone: Tone): string {
  return tone === 'ok' ? c.success : tone === 'warn' ? c.warning : c.textSecondary;
}

/** Small status pill: "✓ 已就绪" / "⚠ 还差 1 步:…" */
export function StatusBadge({ tone, text }: { tone: Tone; text: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const color = toneColor(c, tone);
  return (
    <View style={[styles.badge, { backgroundColor: color + '1A' }]}>
      <Ionicons
        name={tone === 'ok' ? 'checkmark-circle' : tone === 'warn' ? 'alert-circle' : 'ellipse-outline'}
        size={13}
        color={color}
      />
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

/** One row on the Settings hub: icon + title + status line + chevron. */
export function HubRow({
  icon, title, status, tone, onPress,
}: {
  icon: string; title: string; status: string; tone: Tone; onPress: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={styles.hubRow} onPress={onPress}>
      <View style={styles.hubIcon}>
        <Ionicons name={icon as any} size={20} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.hubTitle}>{title}</Text>
        <Text style={[styles.hubStatus, { color: toneColor(c, tone) }]}>{status}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
    </Pressable>
  );
}

/** Page intro — one plain-language sentence about what this page configures. */
export function PageIntro({ children }: { children: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <Text style={styles.intro}>{children}</Text>;
}

export function SectionTitle({ children }: { children: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <Text style={styles.hint}>{children}</Text>;
}

/** Two-to-three option segmented control. */
export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.segmentRow}>
      {options.map(o => (
        <Pressable
          key={o.value}
          style={[styles.segmentBtn, value === o.value && styles.segmentBtnActive]}
          onPress={() => onChange(o.value)}
        >
          <Text style={[styles.segmentText, value === o.value && styles.segmentTextActive]}>{o.label}</Text>
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [text, setText] = useState(value);
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setText(value); }, [value]);

  // Keep the latest text/value/onSave for the unmount-commit below, so leaving
  // the field (or switching provider) without an onBlur still persists the edit
  // to the correct field — and never bleeds it into the other one.
  const latest = useRef({ text, value, onSave });
  latest.current = { text, value, onSave };
  useEffect(() => () => {
    const { text, value, onSave } = latest.current;
    if (text.trim() !== value.trim()) void onSave(text.trim());
  }, []);

  const commit = () => {
    if (text.trim() === value.trim()) return;
    void onSave(text.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.keyRow}>
        <TextInput
          style={styles.keyInput}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={c.textSecondary}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
        />
        <Pressable onPress={() => setShow(s => !s)} hitSlop={8} style={styles.eyeBtn}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={c.textSecondary} />
        </Pressable>
      </View>
      {saved && <Text style={styles.savedNote}>✓ 已自动保存</Text>}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    badge:        { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
    badgeText:    { fontSize: 12, fontWeight: '600' },

    hubRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 10 },
    hubIcon:      { width: 38, height: 38, borderRadius: 10, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center' },
    hubTitle:     { fontSize: 15, fontWeight: '600', color: c.text },
    hubStatus:    { fontSize: 12, marginTop: 2, fontWeight: '500' },

    intro:        { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 16 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginTop: 18, marginBottom: 8 },
    hint:         { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginTop: 6 },
    label:        { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },

    segmentRow:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
    segmentBtn:   { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.surface, alignItems: 'center' },
    segmentBtnActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
    segmentText:  { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    segmentTextActive: { color: c.primary },

    keyRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: c.surface },
    keyInput:     { flex: 1, padding: 12, fontSize: 14, color: c.text },
    eyeBtn:       { paddingHorizontal: 12 },
    savedNote:    { fontSize: 12, color: c.success, marginTop: 4, fontWeight: '600' },
  });
}
