import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Modal, View, Text, FlatList, Pressable, StyleSheet,
  Share, Alert, PanResponder, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { type Level, type LogEntry, getLogEntries, clearLogEntries, clearLogFile, getLogFilePath, subscribeToLogs, setLiveForward, isLiveForwardEnabled } from '../utils/logger';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';

const LEVEL_COLOR: Record<Level, string> = {
  DEBUG: '#94A3B8',
  INFO:  '#3B82F6',
  WARN:  '#F59E0B',
  ERROR: '#EF4444',
};

const LOG_SERVER_URL = 'http://localhost:8765/logs';

function LogRow({ item }: { item: LogEntry }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const color = LEVEL_COLOR[item.level];
  const ctx = item.context && Object.keys(item.context).length
    ? Object.entries(item.context).map(([k, v]) => `${k}=${v}`).join(' ')
    : null;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLevel, { color }]}>{item.level[0]}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowMeta}>{item.time}  <Text style={{ color }}>[{item.tag}]</Text></Text>
        <Text style={styles.rowMsg}>{item.message}</Text>
        {ctx ? <Text style={styles.rowCtx}>{ctx}</Text> : null}
        {item.detail ? <Text style={styles.rowDetail}>{item.detail}</Text> : null}
      </View>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function LogViewerModal({ visible, onClose }: Props) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<Level | null>(null);
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState(isLiveForwardEnabled());
  const listRef = useRef<FlatList>(null);
  const translateY = useRef(new Animated.Value(0)).current;

  const refresh = useCallback(() => setEntries([...getLogEntries()]), []);

  useEffect(() => {
    if (!visible) return;
    refresh();
    const unsub = subscribeToLogs(refresh);
    return unsub;
  }, [visible, refresh]);

  // The responder is created once, so route onClose through a ref to avoid
  // calling a stale closure from an earlier render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const slideOutAndClose = useCallback(() => {
    Animated.timing(translateY, { toValue: 800, duration: 200, useNativeDriver: true })
      .start(() => onCloseRef.current());
  }, [translateY]);

  const springBack = useCallback(() => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
  }, [translateY]);

  // Swipe-down to close. Claim the touch on start: the handle has no tappable
  // children, and move-only negotiation is unreliable inside a Modal on the
  // new architecture (the gesture is never granted, so dragging does nothing).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, { dy, dx }) =>
        dy > 4 && Math.abs(dy) > Math.abs(dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, { dy }) => {
        if (dy > 0) translateY.setValue(dy);
      },
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > 100 || vy > 0.5) {
          slideOutAndClose();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => springBack(),
    })
  ).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible]);

  const displayed = filter ? entries.filter(e => e.level === filter) : entries;

  const logsAsText = () =>
    entries
      .map(e => `[${e.time}][${e.level}][${e.tag}] ${e.message}${e.detail ? '\n' + e.detail : ''}`)
      .join('\n');

  const handleShare = async () => {
    await Share.share({ message: logsAsText(), title: 'App Logs' });
  };

  const handleSendToLaptop = async () => {
    setSending(true);
    try {
      const res = await fetch(LOG_SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: logsAsText(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      Alert.alert('Sent', 'Logs delivered to laptop.');
    } catch {
      Alert.alert(
        'Connection failed',
        'Make sure the log server is running on your laptop:\n\n  node log-server.js\n\nAnd ADB reverse is set:\n  adb reverse tcp:8765 tcp:8765',
      );
    } finally {
      setSending(false);
    }
  };

  const handleClear = () => { clearLogEntries(); clearLogFile(); setEntries([]); };

  const levels: Level[] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, { paddingTop: insets.top || 16, transform: [{ translateY }] }]}>

          {/* Drag handle */}
          <View style={styles.dragArea} hitSlop={{ top: 8, bottom: 8 }} {...panResponder.panHandlers}>
            <View style={styles.dragHandle} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Logs  <Text style={styles.count}>{entries.length}</Text></Text>
            <View style={styles.headerActions}>
              {/* Live stream: POST every new log line to the laptop server as it
                  happens — survives a crash, unlike a one-shot send. */}
              <Pressable
                onPress={() => { const next = !live; setLiveForward(next); setLive(next); }}
                style={styles.iconBtn}
              >
                <Ionicons name={live ? 'radio' : 'radio-outline'} size={20} color={live ? '#34D399' : '#475569'} />
              </Pressable>
              <Pressable onPress={handleSendToLaptop} disabled={sending} style={styles.iconBtn}>
                <Ionicons name="laptop-outline" size={20} color={sending ? '#475569' : '#22D3EE'} />
              </Pressable>
              <Pressable onPress={handleShare} style={styles.iconBtn}>
                <Ionicons name="share-outline" size={20} color={c.primary} />
              </Pressable>
              <Pressable onPress={handleClear} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={20} color={c.error} />
              </Pressable>
              <Pressable onPress={onClose} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color='#94A3B8' />
              </Pressable>
            </View>
          </View>

          {/* Filter chips */}
          <View style={styles.filters}>
            <Pressable style={[styles.chip, !filter && styles.chipActive]} onPress={() => setFilter(null)}>
              <Text style={[styles.chipText, !filter && styles.chipTextActive]}>All</Text>
            </Pressable>
            {levels.map(l => (
              <Pressable
                key={l}
                style={[styles.chip, filter === l && { backgroundColor: LEVEL_COLOR[l] + '22', borderColor: LEVEL_COLOR[l] }]}
                onPress={() => setFilter(f => f === l ? null : l)}
              >
                <Text style={[styles.chipText, filter === l && { color: LEVEL_COLOR[l] }]}>{l}</Text>
              </Pressable>
            ))}
          </View>

          {/* Log list */}
          <FlatList
            ref={listRef}
            data={displayed}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => <LogRow item={item} />}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={<Text style={styles.empty}>No log entries</Text>}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(c: Palette) {
  return StyleSheet.create({
  overlay:       { flex: 1, justifyContent: 'flex-end' },
  sheet:         { flex: 1, backgroundColor: '#0F172A', borderTopLeftRadius: 16, borderTopRightRadius: 16, marginTop: 60 },

  dragArea:      { alignItems: 'center', paddingVertical: 14 },
  dragHandle:    { width: 40, height: 4, borderRadius: 2, backgroundColor: '#334155' },

  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title:         { fontSize: 18, fontWeight: '700', color: '#F8FAFC' },
  count:         { fontSize: 13, fontWeight: '400', color: '#475569' },
  headerActions: { flexDirection: 'row', gap: 4 },
  iconBtn:       { padding: 8 },

  filters:       { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 10 },
  chip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  chipActive:    { backgroundColor: c.primary + '22', borderColor: c.primary },
  chipText:      { fontSize: 12, fontWeight: '600', color: '#94A3B8' },
  chipTextActive:{ color: c.primary },

  list:          { paddingHorizontal: 12, paddingBottom: 24 },
  empty:         { color: '#475569', textAlign: 'center', marginTop: 40, fontSize: 14 },

  row:           { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#1E293B' },
  rowLevel:      { fontSize: 12, fontWeight: '700', width: 14, marginTop: 1, marginRight: 8 },
  rowBody:       { flex: 1 },
  rowMeta:       { fontSize: 10, color: '#475569', marginBottom: 1 },
  rowMsg:        { fontSize: 12, color: '#CBD5E1', fontFamily: 'monospace' },
  rowCtx:        { fontSize: 10, color: '#5EEAD4', fontFamily: 'monospace', marginTop: 1 },
  rowDetail:     { fontSize: 11, color: '#64748B', fontFamily: 'monospace', marginTop: 2 },
  });
}
