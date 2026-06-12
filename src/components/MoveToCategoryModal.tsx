import React from 'react';
import { Modal, View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Category } from '../types';
import { COLORS } from '../constants/colors';

interface Props {
  visible: boolean;
  categories: Category[];
  // The category the files currently live in — hidden from the target list.
  currentCategoryId: number | null;
  onSelect: (categoryId: number | null) => void;
  onClose: () => void;
}

type Target = { id: number | null; name: string };

export default function MoveToCategoryModal({
  visible, categories, currentCategoryId, onSelect, onClose,
}: Props) {
  const targets: Target[] = [
    ...(currentCategoryId !== null ? [{ id: null, name: 'Uncategorized' }] : []),
    ...categories
      .filter(c => c.id !== currentCategoryId)
      .map(c => ({ id: c.id, name: c.name })),
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>Move to category</Text>
          {targets.length === 0 ? (
            <Text style={styles.empty}>No other category yet. Create one from the Home screen first.</Text>
          ) : (
            <FlatList
              data={targets}
              keyExtractor={t => String(t.id ?? 'uncategorized')}
              style={styles.list}
              renderItem={({ item }) => (
                <Pressable style={styles.rowItem} onPress={() => { onSelect(item.id); onClose(); }}>
                  <Ionicons
                    name={item.id === null ? 'file-tray-outline' : 'folder-outline'}
                    size={20}
                    color={COLORS.primary}
                  />
                  <Text style={styles.rowText} numberOfLines={1}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 32 },
  dialog:     { backgroundColor: COLORS.surface, borderRadius: 14, padding: 20, maxHeight: '70%' },
  title:      { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  list:       { flexGrow: 0 },
  empty:      { fontSize: 14, color: COLORS.textSecondary, paddingVertical: 12 },
  rowItem:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: COLORS.border },
  rowText:    { fontSize: 15, color: COLORS.text, flex: 1 },
  cancelBtn:  { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, marginTop: 8 },
  cancelText: { color: COLORS.textSecondary, fontSize: 15 },
});
