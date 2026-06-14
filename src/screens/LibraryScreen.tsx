import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput,
  StyleSheet, Alert, Modal, useWindowDimensions,
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

const MASTERY_OPTIONS: Array<{ value: MasteryLevel; label: string }> = [
  { value: 'new',      label: 'New'      },
  { value: 'learning', label: 'Learning' },
  { value: 'mastered', label: 'Mastered' },
];

type Anchor = { x: number; y: number; width: number; height: number };

// ─── Mastery dropdown ─────────────────────────────────────────────────────────
// Small popover anchored under (or above) the tapped mastery badge. Replaces the
// old tap-to-cycle, which was easy to overshoot and gave no choice of target.

function MasteryMenu({
  anchor, current, onSelect, onClose,
}: {
  anchor: Anchor;
  current: MasteryLevel;
  onSelect: (m: MasteryLevel) => void;
  onClose: () => void;
}) {
  const { height: screenH } = useWindowDimensions();
  const MENU_W = 150;
  const MENU_H = MASTERY_OPTIONS.length * 44 + 8;
  const openUp = anchor.y + anchor.height + MENU_H > screenH - 24;
  const top = openUp ? anchor.y - MENU_H - 4 : anchor.y + anchor.height + 4;
  const left = Math.max(8, anchor.x + anchor.width - MENU_W);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[styles.menu, { top, left, width: MENU_W }]}>
        {MASTERY_OPTIONS.map(o => (
          <Pressable key={o.value} style={styles.menuItem} onPress={() => onSelect(o.value)}>
            <View style={[styles.menuDot, { backgroundColor: MASTERY_COLOR[o.value] }]} />
            <Text style={styles.menuItemText}>{o.label}</Text>
            {current === o.value && (
              <Ionicons name="checkmark" size={16} color={COLORS.primary} style={styles.menuCheck} />
            )}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

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
  item, onPress, onDelete, onOpenMastery,
}: {
  item: SavedItem;
  onPress: () => void;
  onDelete: () => void;
  onOpenMastery: (anchor: Anchor) => void;
}) {
  const badgeRef = useRef<View>(null);
  const openMenu = () => {
    badgeRef.current?.measureInWindow((x, y, width, height) =>
      onOpenMastery({ x, y, width, height })
    );
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
          ref={badgeRef}
          style={[styles.masteryBadge, { backgroundColor: MASTERY_COLOR[item.mastery] + '22' }]}
          onPress={openMenu}
          hitSlop={6}
        >
          <Text style={[styles.masteryText, { color: MASTERY_COLOR[item.mastery] }]}>
            {item.mastery}
          </Text>
          <Ionicons name="chevron-down" size={12} color={MASTERY_COLOR[item.mastery]} />
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
  const [masteryMenu, setMasteryMenu] = useState<{ item: SavedItem; anchor: Anchor } | null>(null);

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
            onOpenMastery={anchor => setMasteryMenu({ item, anchor })}
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

      {masteryMenu && (
        <MasteryMenu
          anchor={masteryMenu.anchor}
          current={masteryMenu.item.mastery}
          onSelect={m => { updateMastery(masteryMenu.item.id, m); setMasteryMenu(null); }}
          onClose={() => setMasteryMenu(null)}
        />
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
  masteryBadge:    { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  masteryText:     { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  menu:            { position: 'absolute', backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuItem:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44 },
  menuDot:         { width: 9, height: 9, borderRadius: 5 },
  menuItemText:    { fontSize: 14, color: COLORS.text, fontWeight: '500' },
  menuCheck:       { marginLeft: 'auto' },

  empty:           { alignItems: 'center', paddingTop: 60 },
  emptyTitle:      { fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 16 },
  emptySubtitle:   { fontSize: 14, color: COLORS.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
});
