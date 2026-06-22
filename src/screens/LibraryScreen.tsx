import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput,
  StyleSheet, Alert, Modal, useWindowDimensions,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, useAnimatedReaction,
  withTiming, withSpring, runOnJS, Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Palette } from '../constants/colors';
import { useTheme } from '../theme/ThemeProvider';
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

const makeMasteryColor = (c: Palette): Record<MasteryLevel, string> => ({
  new:      c.warning,
  learning: c.primary,
  mastered: c.success,
});

const MASTERY_OPTIONS: Array<{ value: MasteryLevel; label: string }> = [
  { value: 'new',      label: 'New'      },
  { value: 'learning', label: 'Learning' },
  { value: 'mastered', label: 'Mastered' },
];

type Anchor = { x: number; y: number; width: number; height: number };
type SwipeSide = 'left' | 'right';
type MasterySwipeTargets = { left: MasteryLevel; right: MasteryLevel };
type MasterySwipePreview = MasterySwipeTargets & { active: SwipeSide | null };

const SWIPE_THRESHOLD = 88;          // px past which the swipe commits the tag
const SWIPE_PREVIEW_ACTIVATE = 24;   // px to light up a side's preview
const SWIPE_PREVIEW_CLEAR = 8;       // px back inside which the preview clears
// Settle/return spring — clamped so it never overshoots (no recoil/bounce).
const RETURN_SPRING = { damping: 22, stiffness: 190, overshootClamping: true } as const;

const masteryLabel = (m: MasteryLevel) => MASTERY_OPTIONS.find(o => o.value === m)?.label ?? m;

function getSwipeTargets(current: MasteryLevel): MasterySwipeTargets {
  switch (current) {
    case 'new':
      return { left: 'learning', right: 'mastered' };
    case 'learning':
      return { left: 'new', right: 'mastered' };
    case 'mastered':
      return { left: 'new', right: 'learning' };
  }
}

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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
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
            <View style={[styles.menuDot, { backgroundColor: masteryColor[o.value] }]} />
            <Text style={styles.menuItemText}>{o.label}</Text>
            {current === o.value && (
              <Ionicons name="checkmark" size={16} color={c.primary} style={styles.menuCheck} />
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
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
  item, onPress, onDelete, onOpenMastery, onStartSelect,
  onSwipeMastery, onSwipePreviewChange, selectionMode, selected, onToggleSelect,
}: {
  item: SavedItem;
  onPress: () => void;
  onDelete: () => void;
  onOpenMastery: (anchor: Anchor) => void;
  onStartSelect: () => void;
  onSwipeMastery: (item: SavedItem, mastery: MasteryLevel) => void;
  onSwipePreviewChange: (preview: MasterySwipePreview | null) => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
  const swipeTargets = useMemo(() => getSwipeTargets(item.mastery), [item.mastery]);
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(0);
  const dragging = useSharedValue(false);
  const badgeRef = useRef<View>(null);

  // The preview overlay lives in the parent (one shared band at the screen
  // edges). Only the actively-swiped card writes to it. These callbacks are
  // kept stable so the memoized gesture survives the parent's re-renders that
  // those very writes trigger — otherwise GestureDetector would re-attach the
  // native gesture mid-swipe and cancel the drag.
  const showPreview = useCallback(
    (side: SwipeSide | null) => onSwipePreviewChange({ ...swipeTargets, active: side }),
    [onSwipePreviewChange, swipeTargets],
  );
  const clearPreview = useCallback(() => onSwipePreviewChange(null), [onSwipePreviewChange]);

  // Light up the active side as the card crosses the preview thresholds, with a
  // dead band for hysteresis. Fires the JS callback only when the side actually
  // changes — never per frame.
  useAnimatedReaction(
    () => {
      if (!dragging.value) return undefined; // ignore the return/settle animation
      const x = translateX.value;
      if (x <= -SWIPE_PREVIEW_ACTIVATE) return 'left' as SwipeSide;
      if (x >= SWIPE_PREVIEW_ACTIVATE) return 'right' as SwipeSide;
      if (x > -SWIPE_PREVIEW_CLEAR && x < SWIPE_PREVIEW_CLEAR) return null;
      return undefined; // inside the hysteresis band — leave the side as-is
    },
    (current, previous) => {
      if (current !== undefined && current !== previous) runOnJS(showPreview)(current);
    },
  );

  const pan = useMemo(
    () => Gesture.Pan()
      .enabled(!selectionMode)
      .activeOffsetX([-14, 14]) // claim the touch only on a clear horizontal drag
      .failOffsetY([-12, 12])   // vertical intent → yield to the list's scroll
      .onStart(() => {
        dragging.value = true;
        runOnJS(showPreview)(null);
      })
      .onUpdate(e => {
        translateX.value = e.translationX; // 1:1 finger-follow — no clamp, no wall
      })
      .onEnd(e => {
        const t = e.translationX;
        dragging.value = false; // stop driving the preview during the return anim
        runOnJS(clearPreview)();
        if (t <= -SWIPE_THRESHOLD || t >= SWIPE_THRESHOLD) {
          const dir = t < 0 ? -1 : 1;
          const target = dir < 0 ? swipeTargets.left : swipeTargets.right;
          // Fly out toward the swiped side, then settle back with the new tag
          // applied (or the row is filtered out and unmounts — no snap either way).
          translateX.value = withTiming(
            dir * width,
            { duration: 190, easing: Easing.out(Easing.cubic) },
            finished => {
              if (finished) {
                runOnJS(onSwipeMastery)(item, target);
                translateX.value = withSpring(0, RETURN_SPRING);
              }
            },
          );
        } else {
          translateX.value = withSpring(0, RETURN_SPRING); // below threshold — glide home
        }
      })
      .onFinalize(() => {
        dragging.value = false;
        runOnJS(clearPreview)(); // safety net if the gesture was cancelled
      }),
    [selectionMode, swipeTargets, width, item, showPreview, clearPreview, onSwipeMastery, translateX, dragging],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    zIndex: translateX.value !== 0 ? 3 : 0,
  }));

  const openMenu = () => {
    badgeRef.current?.measureInWindow((x, y, w, h) =>
      onOpenMastery({ x, y, width: w, height: h })
    );
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.cardMotion, animatedStyle]}>
        <Pressable
          style={[styles.card, selected && styles.cardSelected]}
          onPress={selectionMode ? onToggleSelect : onPress}
        >
        <View style={styles.cardTop}>
          {selectionMode && (
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={selected ? c.primary : c.textSecondary}
              style={styles.selectDot}
            />
          )}
          <Text style={styles.cardText}>{item.text}</Text>
          <View style={styles.cardTopIcons}>
            {item.enrichment && (
              <Ionicons name="sparkles" size={13} color={c.primary} />
            )}
            {!selectionMode && (
              <>
                <Pressable onPress={onStartSelect} hitSlop={8}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={c.textSecondary} />
                </Pressable>
                <Pressable onPress={onDelete} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={c.textSecondary} />
                </Pressable>
              </>
            )}
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
            style={[styles.masteryBadge, { backgroundColor: masteryColor[item.mastery] + '22' }]}
            onPress={openMenu}
            disabled={selectionMode}
            hitSlop={6}
          >
            <Text style={[styles.masteryText, { color: masteryColor[item.mastery] }]}>
              {item.mastery}
            </Text>
            <Ionicons name="chevron-down" size={12} color={masteryColor[item.mastery]} />
          </Pressable>
        </View>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

// ─── Batch mastery picker (selection mode) ────────────────────────────────────

function BatchMasteryModal({
  count, onSelect, onClose,
}: {
  count: number;
  onSelect: (m: MasteryLevel) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.batchBackdrop} onPress={onClose}>
        <View style={styles.batchCard}>
          <Text style={styles.batchTitle}>将选中的 {count} 项标记为</Text>
          {MASTERY_OPTIONS.map(o => (
            <Pressable key={o.value} style={styles.batchRow} onPress={() => onSelect(o.value)}>
              <View style={[styles.menuDot, { backgroundColor: masteryColor[o.value] }]} />
              <Text style={styles.menuItemText}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// ─── LibraryScreen ────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const insets = useSafeAreaInsets();
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const masteryColor = useMemo(() => makeMasteryColor(c), [c]);
  const {
    items, filteredItems, filter, isLoading,
    loadItems, removeItem, removeItems, updateMastery, updateMasteryMany, setFilter, resetFilter,
  } = useLibraryStore();
  const [selectedItem, setSelectedItem] = useState<SavedItem | null>(null);
  const [masteryMenu, setMasteryMenu] = useState<{ item: SavedItem; anchor: Anchor } | null>(null);
  const [swipePreview, setSwipePreview] = useState<MasterySwipePreview | null>(null);

  // Multi-select (batch delete / batch tag). Entered from the card select icon.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchMasteryOpen, setBatchMasteryOpen] = useState(false);

  useEffect(() => { loadItems(); }, []);

  const handleDelete = (item: SavedItem) => {
    Alert.alert('Delete', `Remove "${item.text}" from your library?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeItem(item) },
    ]);
  };

  // ── Selection helpers ──
  const enterSelection = (item: SavedItem) => {
    setSelectionMode(true);
    setSelectedIds(new Set([item.id]));
  };
  const exitSelection = () => { setSelectionMode(false); setSelectedIds(new Set()); };
  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allSelected = filteredItems.length > 0 && selectedIds.size >= filteredItems.length;
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(filteredItems.map(i => i.id)));

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    Alert.alert('批量删除', `从词库中删除选中的 ${selectedIds.size} 项?`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => {
          await removeItems(items.filter(i => selectedIds.has(i.id)));
          exitSelection();
        } },
    ]);
  };

  const handleBatchMastery = async (m: MasteryLevel) => {
    await updateMasteryMany(Array.from(selectedIds), m);
    setBatchMasteryOpen(false);
    exitSelection();
  };

  const handleSwipeMastery = useCallback((item: SavedItem, mastery: MasteryLevel) => {
    void updateMastery(item.id, mastery, { refilter: filter.mastery !== 'all' });
  }, [filter.mastery, updateMastery]);

  return (
    <View style={[styles.screen, { paddingTop: 0 }]}>
      {swipePreview && (
        <View pointerEvents="none" style={styles.swipePreviewLayer}>
          <View
            style={[
              styles.swipePreviewZone,
              styles.swipePreviewLeft,
              {
                backgroundColor: masteryColor[swipePreview.left] + (swipePreview.active === 'left' ? '32' : '20'),
                borderColor: masteryColor[swipePreview.left] + '66',
                opacity: swipePreview.active === 'right' ? 0.72 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-back" size={18} color={masteryColor[swipePreview.left]} />
            <Text style={[styles.swipePreviewText, { color: masteryColor[swipePreview.left] }]}>
              {masteryLabel(swipePreview.left)}
            </Text>
          </View>
          <View
            style={[
              styles.swipePreviewZone,
              styles.swipePreviewRight,
              {
                backgroundColor: masteryColor[swipePreview.right] + (swipePreview.active === 'right' ? '32' : '20'),
                borderColor: masteryColor[swipePreview.right] + '66',
                opacity: swipePreview.active === 'left' ? 0.72 : 1,
              },
            ]}
          >
            <Ionicons name="arrow-forward" size={18} color={masteryColor[swipePreview.right]} />
            <Text style={[styles.swipePreviewText, { color: masteryColor[swipePreview.right] }]}>
              {masteryLabel(swipePreview.right)}
            </Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={c.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search saved items…"
          placeholderTextColor={c.textSecondary}
          value={filter.searchQuery}
          onChangeText={q => setFilter({ searchQuery: q })}
          returnKeyType="search"
        />
        {filter.searchQuery.length > 0 && (
          <Pressable onPress={() => setFilter({ searchQuery: '' })}>
            <Ionicons name="close-circle" size={16} color={c.textSecondary} />
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

      {/* Results count + sort — or selection controls when multi-selecting */}
      {!selectionMode ? (
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
              <Ionicons name="swap-vertical" size={12} color={c.primary} />
              <Text style={styles.sortText}>
                {SORT_CYCLE.find(s => s.value === filter.sortBy)?.label ?? 'Newest'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.countRow}>
          <Pressable onPress={exitSelection} hitSlop={6}>
            <Text style={styles.clearFilter}>取消</Text>
          </Pressable>
          <Text style={styles.countText}>已选 {selectedIds.size} 项</Text>
          <Pressable onPress={toggleSelectAll} style={styles.sortBtn}>
            <Ionicons name={allSelected ? 'remove-circle-outline' : 'checkmark-done'} size={12} color={c.primary} />
            <Text style={styles.sortText}>{allSelected ? '取消全选' : '全选'}</Text>
          </Pressable>
        </View>
      )}

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
            onStartSelect={() => { if (!selectionMode) enterSelection(item); }}
            onSwipeMastery={handleSwipeMastery}
            onSwipePreviewChange={setSwipePreview}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
          />
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: (selectionMode ? 80 : 0) + insets.bottom + 16 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={56} color={c.border} />
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
          onSelect={m => {
            updateMastery(masteryMenu.item.id, m, { refilter: filter.mastery !== 'all' });
            setMasteryMenu(null);
          }}
          onClose={() => setMasteryMenu(null)}
        />
      )}

      {/* Batch action bar (selection mode) */}
      {selectionMode && (
        <View style={[styles.batchBar, { paddingBottom: insets.bottom + 8 }]}>
          <Pressable
            style={[styles.batchBtn, selectedIds.size === 0 && styles.batchBtnDisabled]}
            onPress={() => selectedIds.size > 0 && setBatchMasteryOpen(true)}
          >
            <Ionicons name="pricetag-outline" size={18} color={c.primary} />
            <Text style={styles.batchBtnText}>标记</Text>
          </Pressable>
          <Pressable
            style={[styles.batchBtn, styles.batchDeleteBtn, selectedIds.size === 0 && styles.batchBtnDisabled]}
            onPress={handleBatchDelete}
          >
            <Ionicons name="trash-outline" size={18} color={c.error} />
            <Text style={[styles.batchBtnText, { color: c.error }]}>删除 ({selectedIds.size})</Text>
          </Pressable>
        </View>
      )}

      {batchMasteryOpen && (
        <BatchMasteryModal
          count={selectedIds.size}
          onSelect={handleBatchMastery}
          onClose={() => setBatchMasteryOpen(false)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Palette) {
  return StyleSheet.create({
  screen:          { flex: 1, backgroundColor: c.background },

  searchRow:       { flexDirection: 'row', alignItems: 'center', margin: 16, paddingHorizontal: 12, backgroundColor: c.surface, borderRadius: 12, borderWidth: 1, borderColor: c.border },
  searchIcon:      { marginRight: 8 },
  searchInput:     { flex: 1, paddingVertical: 10, fontSize: 14, color: c.text },

  filterRow:       { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  chip:            { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  chipActive:      { backgroundColor: c.primary, borderColor: c.primary },
  chipText:        { fontSize: 12, color: c.textSecondary, fontWeight: '500' },
  chipTextActive:  { color: '#fff' },

  countRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  countText:       { fontSize: 12, color: c.textSecondary },
  countActions:    { flexDirection: 'row', alignItems: 'center', gap: 14 },
  clearFilter:     { fontSize: 12, color: c.primary, fontWeight: '600' },
  sortBtn:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.primaryLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  sortText:        { fontSize: 12, color: c.primary, fontWeight: '600' },

  cardMotion:      { marginBottom: 10 },
  card:            { backgroundColor: c.surface, borderRadius: 12, padding: 14 },
  cardSelected:    { borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.primaryLight },
  selectDot:       { marginRight: 8, marginTop: 1 },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardTopIcons:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardText:        { fontSize: 16, fontWeight: '700', color: c.text, flex: 1, marginRight: 8 },
  cardContext:     { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', lineHeight: 19, marginBottom: 10 },
  cardBottom:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  typeBadge:       { backgroundColor: c.border, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText:   { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  cardDate:        { fontSize: 11, color: c.textSecondary },
  nextReview:      { fontSize: 11, color: c.textSecondary, flex: 1 },
  masteryBadge:    { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  masteryText:     { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },

  swipePreviewLayer:{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  swipePreviewZone:{ width: 104, minHeight: 118, borderWidth: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  swipePreviewLeft:{ borderTopRightRadius: 16, borderBottomRightRadius: 16, borderLeftWidth: 0 },
  swipePreviewRight:{ borderTopLeftRadius: 16, borderBottomLeftRadius: 16, borderRightWidth: 0 },
  swipePreviewText:{ fontSize: 12, fontWeight: '800', textTransform: 'capitalize' },

  menu:            { position: 'absolute', backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuItem:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, height: 44 },
  menuDot:         { width: 9, height: 9, borderRadius: 5 },
  menuItemText:    { fontSize: 14, color: c.text, fontWeight: '500' },
  menuCheck:       { marginLeft: 'auto' },

  batchBar:        { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 10, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border },
  batchBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.primaryLight },
  batchDeleteBtn:  { borderColor: c.error, backgroundColor: c.error + '14' },
  batchBtnDisabled:{ opacity: 0.4 },
  batchBtnText:    { fontSize: 14, fontWeight: '700', color: c.primary },

  batchBackdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 40 },
  batchCard:       { backgroundColor: c.surface, borderRadius: 14, paddingVertical: 8 },
  batchTitle:      { fontSize: 14, fontWeight: '700', color: c.text, paddingHorizontal: 16, paddingVertical: 12 },
  batchRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, height: 48 },

  empty:           { alignItems: 'center', paddingTop: 60 },
  emptyTitle:      { fontSize: 18, fontWeight: '700', color: c.text, marginTop: 16 },
  emptySubtitle:   { fontSize: 14, color: c.textSecondary, marginTop: 8, textAlign: 'center', paddingHorizontal: 32 },
  });
}
