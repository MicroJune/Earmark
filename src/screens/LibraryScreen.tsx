import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput,
  StyleSheet, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/colors';
import { useLibraryStore, type LibrarySort } from '../store/libraryStore';
import type { SavedItem, SavedItemType, MasteryLevel } from '../types';
import { formatRelativeDate, formatNextReview } from '../utils/timeFormat';
import ItemDetailModal from '../components/ItemDetailModal';

// ─── Filter bar ───────────────────────────────────────────────────────────────

const TYPE_FILTERS: Array<{ label: string; value: SavedItemType | 'all' }> = [
  { label: 'All',       value: 'all'      },
  { label: 'Words',     value: 'word'     },
  { label: 'Phrases',   value: 'phrase'   },
  { label: 'Sentences', value: 'sentence' },
];

const MASTERY_FILTERS: Array<{ label: string; value: MasteryLevel | 'all' }> = [
  { label: 'All',      value: 'all'      },
  { label: 'New',      value: 'new'      },
  { label: 'Learning', value: 'learning' },
  { label: 'Mastered', value: 'mastered' },
];

const MASTERY_COLOR: Record<MasteryLevel, string> = {
  new:      COLORS.warning,
  learning: COLORS.primary,
  mastered: COLORS.success,
};

const SORT_CYCLE: Array<{ value: LibrarySort; label: string }> = [
  { value: 'newest',  label: 'Newest'   },
  { value: 'oldest',  label: 'Oldest'   },
  { value: 'mastery', label: 'Mastery'  },
  { value: 'alpha',   label: 'A–Z'      },
];

function FilterChip<T extends string>({
  label, active, onPress,
}: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// ─── Saved item card ──────────────────────────────────────────────────────────

function SavedItemCard({
  item, onPress, onDelete, onMasteryChange,
}: {
  item: SavedItem;
  onPress: () => void;
  onDelete: () => void;
  onMasteryChange: (mastery: MasteryLevel) => void;
}) {
  const MASTERY_CYCLE: MasteryLevel[] = ['new', 'learning', 'mastered'];
  const cycleNextMastery = () => {
    const next = MASTERY_CYCLE[(MASTERY_CYCLE.indexOf(item.mastery) + 1) % MASTERY_CYCLE.length];
    onMasteryChange(next);
  };

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={styles.cardTop}>
        <Text style={styles.cardText}>{item.text}</Text>
        <View style={styles.cardTopIcons}>
          {item.enrichment && (
            <Ionicons name="sparkles" size={13} color={COLORS.primary} />
          )}
          <Pressable onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={COLORS.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.cardContext} numberOfLines={2}>"{item.contextSentence}"</Text>

      <View style={styles.cardBottom}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{item.type}</Text>
        </View>
        <Text style={styles.cardDate}>{formatRelativeDate(item.dateAdded)}</Text>
        <Text style={styles.nextReview}>{formatNextReview(item.nextReview)}</Text>
        <Pressable
          style={[styles.masteryBadge, { backgroundColor: MASTERY_COLOR[item.mastery] + '22' }]}
          onPress={cycleNextMastery}
        >
          <Text style={[styles.masteryText, { color: MASTERY_COLOR[item.mastery] }]}>
            {item.mastery}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── LibraryScreen ────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const {
    filteredItems, filter, isLoading,
    loadItems, removeItem, updateMastery, setFilter, resetFilter,
  } = useLibraryStore();
  const [selectedItem, setSelectedItem] = useState<SavedItem | null>(null);

  useEffect(() => { loadItems(); }, []);

  const handleDelete = (item: SavedItem) => {
    Alert.alert('Delete', `Remove "${item.text}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeItem(item) },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: 0 }]}>
      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search saved items…"
          placeholderTextColor={COLORS.textSecondary}
          value={filter.searchQuery}
          onChangeText={q => setFilter({ searchQuery: q })}
          returnKeyType="search"
        />
        {filter.searchQuery.length > 0 && (
          <Pressable onPress={() => setFilter({ searchQuery: '' })}>
            <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Type filter */}
      <View style={styles.filterRow}>
        {TYPE_FILTERS.map(f => (
          <FilterChip
            key={f.value}
            label={f.label}
            active={filter.type === f.value}
            onPress={() => setFilter({ type: f.value })}
          />
        ))}
      </View>

      {/* Mastery filter */}
      <View style={styles.filterRow}>
        {MASTERY_FILTERS.map(f => (
          <FilterChip
            key={f.value}
            label={f.label}
            active={filter.mastery === f.value}
            onPress={() => setFilter({ mastery: f.value })}
          />
        ))}
      </View>

      {/* Results count + sort */}
      <View style={styles.countRow}>
        <Text style={styles.countText}>{filteredItems.length} items</Text>
        <View style={styles.countActions}>
          {(filter.type !== 'all' || filter.mastery !== 'all' || filter.searchQuery) && (
            <Pressable onPress={resetFilter}>
              <Text style={styles.clearFilter}>Clear filters</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.sortBtn}
            onPress={() => {
              const idx = SORT_CYCLE.findIndex(s => s.value === filter.sortBy);
              setFilter({ sortBy: SORT_CYCLE[(idx + 1) % SORT_CYCLE.length].value });
            }}
          >
            <Ionicons name="swap-vertical" size={12} color={COLORS.primary} />
            <Text style={styles.sortText}>
              {SORT_CYCLE.find(s => s.value === filter.sortBy)?.label ?? 'Newest'}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* List */}
      <FlatList
        data={filteredItems}
        keyExtractor={item => String(item.id)}
        renderItem={({ item }) => (
          <SavedItemCard
            item={item}
            onPress={() => setSelectedItem(item)}
            onDelete={() => handleDelete(item)}
            onMasteryChange={m => updateMastery(item.id, m)}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={56} color={COLORS.border} />
            <Text style={styles.emptyTitle}>No saved items</Text>
            <Text style={styles.emptySubtitle}>
              Tap and hold words in a transcript to save them
            </Text>
          </View>
        }
      />

      {selectedItem && (
        <ItemDetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen:          { flex: 1, backgroundColor: COLORS.background },

  searchRow:       { flexDirection: 'row', alignItems: 'center', margin: 16, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border },
  searchIcon:      { marginRight: 8 },
  searchInput:     { flex: 1, paddingVertical: 10, fontSize: 14, color: COLORS.text },

  filterRow:       { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  chip:            { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  chipActive:      { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText:        { fontSize: 12, color: COLORS.textSecondary, fontWeight: '500' },
  chipTextActive:  { color: '#fff' },

  countRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  countText:       { fontSize: 12, color: COLORS.textSecondary },
  countActions:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  clearFilter:     { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  sortBtn:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  sortText:        { fontSize: 12, color: COLORS.primary, fontWeight: '600' },

  card:            { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardTopIcons:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardText:        { fontSize: 16, fontWeight: '700', color: COLORS.text, flex: 1, marginRight: 8 },
  cardContext:     { fontSize: 13, color: COLORS.textSecondary, fontStyle: 'italic', lineHeight: 19, marginBottom: 10 },
  cardBottom:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeBadge:       { backgroundColor: COLORS.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:   { fontSize: 11, color: COLORS.textSecondary, fontWeight: '600' },
  cardDate:        { fontSize: 11, color: COLORS.textSecondary },
  nextReview:      { fontSize: 11, color: COLORS.textSecondary, flex: 1 },
  masteryBadge:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  masteryText:     { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  empty:           { alignItems: 'center', paddingTop: 60 },
  emptyTitle:      { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 16 },
  emptySubtitle:   { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
