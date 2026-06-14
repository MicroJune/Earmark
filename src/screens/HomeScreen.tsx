import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList, Category } from '../types';
import type { Palette } from '../constants/colors';
import { useTheme } from '../theme/ThemeProvider';
import { useAudioFilesStore } from '../store/audioFilesStore';
import SettingsModal from '../components/SettingsModal';
import CategoryNameModal from '../components/CategoryNameModal';

type Props = NativeStackScreenProps<HomeStackParamList, 'HomeScreen'>;

// ─── Category card ────────────────────────────────────────────────────────────

function CategoryCard({
  name,
  fileCount,
  isUncategorized,
  onPress,
  onLongPress,
}: {
  name: string;
  fileCount: number;
  isUncategorized?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable style={styles.card} onPress={onPress} onLongPress={onLongPress}>
      <View style={styles.cardIcon}>
        <Ionicons
          name={isUncategorized ? 'file-tray-outline' : 'folder-outline'}
          size={24}
          color={c.primary}
        />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{name}</Text>
        <Text style={styles.cardCount}>
          {fileCount} file{fileCount === 1 ? '' : 's'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textSecondary} />
    </Pressable>
  );
}

// ─── HomeScreen (category overview) ───────────────────────────────────────────

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [nameModal, setNameModal] = useState<{ mode: 'create' } | { mode: 'rename'; category: Category } | null>(null);
  const { audioFiles, categories, loadAudioFiles, loadCategories } = useAudioFilesStore();

  useEffect(() => {
    loadAudioFiles();
    loadCategories();
  }, []);

  useEffect(() => {
    navigation.setOptions({
      headerTitle: 'Earmark',
      headerRight: () => (
        <Pressable onPress={() => setSettingsVisible(true)} style={{ padding: 4, marginRight: 4 }}>
          <Ionicons name="settings-outline" size={22} color={c.primary} />
        </Pressable>
      ),
    });
  }, [navigation, c]);

  const countFor = useCallback(
    (categoryId: number | null) => audioFiles.filter(f => f.categoryId === categoryId).length,
    [audioFiles]
  );

  const openCategory = useCallback((categoryId: number | null, categoryName: string) => {
    navigation.navigate('CategoryView', { categoryId, categoryName });
  }, [navigation]);

  const handleCategoryLongPress = useCallback((category: Category) => {
    Alert.alert(category.name, undefined, [
      { text: 'Rename', onPress: () => setNameModal({ mode: 'rename', category }) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const count = countFor(category.id);
          Alert.alert(
            `Delete "${category.name}"`,
            count > 0
              ? `Its ${count} file${count === 1 ? '' : 's'} will be moved to Uncategorized. No audio or saved phrases are deleted.`
              : 'This category is empty.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => useAudioFilesStore.getState().removeCategory(category.id),
              },
            ]
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [countFor]);

  const handleNameSubmit = useCallback(async (name: string) => {
    const store = useAudioFilesStore.getState();
    try {
      if (nameModal?.mode === 'rename') {
        await store.updateCategoryName(nameModal.category.id, name);
      } else {
        await store.addCategory(name);
      }
    } catch (e) {
      Alert.alert('Failed', e instanceof Error ? e.message : 'Could not save category');
    }
  }, [nameModal]);

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <FlatList
        data={categories}
        keyExtractor={item => String(item.id)}
        ListHeaderComponent={
          <CategoryCard
            name="Uncategorized"
            fileCount={countFor(null)}
            isUncategorized
            onPress={() => openCategory(null, 'Uncategorized')}
          />
        }
        renderItem={({ item }) => (
          <CategoryCard
            name={item.name}
            fileCount={countFor(item.id)}
            onPress={() => openCategory(item.id, item.name)}
            onLongPress={() => handleCategoryLongPress(item)}
          />
        )}
        contentContainerStyle={styles.list}
        ListFooterComponent={
          categories.length === 0 ? (
            <Text style={styles.hint}>
              Tap the folder button to create a category, then import or move podcasts into it.
            </Text>
          ) : null
        }
      />

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 24 }]}
        onPress={() => setNameModal({ mode: 'create' })}
      >
        <Ionicons name="folder-open" size={26} color="#fff" />
        <View style={styles.fabPlusBadge}>
          <Ionicons name="add" size={14} color="#fff" />
        </View>
      </Pressable>

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <CategoryNameModal
        visible={nameModal !== null}
        title={nameModal?.mode === 'rename' ? 'Rename Category' : 'New Category'}
        initialName={nameModal?.mode === 'rename' ? nameModal.category.name : ''}
        existingNames={categories.map(c => c.name)}
        onSubmit={handleNameSubmit}
        onClose={() => setNameModal(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Palette) {
  return StyleSheet.create({
  screen:       { flex: 1, backgroundColor: c.background },
  list:         { padding: 16, flexGrow: 1 },

  card:         { flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardIcon:     { width: 44, height: 44, borderRadius: 10, backgroundColor: c.primaryLight, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  cardBody:     { flex: 1 },
  cardTitle:    { fontSize: 15, fontWeight: '600', color: c.text, marginBottom: 2 },
  cardCount:    { fontSize: 12, color: c.textSecondary },

  hint:         { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 24, paddingHorizontal: 32, lineHeight: 19 },

  fab:          { position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: c.primary, shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  fabPlusBadge: { position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: 9, backgroundColor: c.primary, borderWidth: 1.5, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  });
}
