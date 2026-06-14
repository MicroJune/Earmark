import React, { useEffect, useState, useMemo } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';

interface Props {
  visible: boolean;
  title: string;              // "New Category" | "Rename Category"
  initialName?: string;
  existingNames: string[];    // for duplicate validation (case-insensitive)
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export default function CategoryNameModal({
  visible, title, initialName, existingNames, onSubmit, onClose,
}: Props) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(initialName ?? '');
      setError(null);
    }
  }, [visible, initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    const isDuplicate = existingNames.some(
      n => n.toLowerCase() === trimmed.toLowerCase() && n !== initialName
    );
    if (isDuplicate) {
      setError('A category with this name already exists');
      return;
    }
    onSubmit(trimmed);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={t => { setName(t); setError(null); }}
            placeholder="Category name"
            placeholderTextColor={c.textSecondary}
            autoFocus
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.btn}>
              <Text style={styles.btnCancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={handleSubmit} style={styles.btn}>
              <Text style={styles.btnSave}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
    backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 32 },
    dialog:    { backgroundColor: c.surface, borderRadius: 14, padding: 20 },
    title:     { fontSize: 17, fontWeight: '700', color: c.text, marginBottom: 14 },
    input:     { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.text },
    error:     { color: c.error, fontSize: 12, marginTop: 6 },
    actions:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
    btn:       { paddingHorizontal: 14, paddingVertical: 8 },
    btnCancel: { color: c.textSecondary, fontSize: 15 },
    btnSave:   { color: c.primary, fontSize: 15, fontWeight: '700' },
  });
}
