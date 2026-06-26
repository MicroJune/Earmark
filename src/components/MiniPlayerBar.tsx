import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { usePlaybackStore } from '../store/playbackStore';
import { useAudioFilesStore } from '../store/audioFilesStore';
import { play, pause } from '../services/audio';
import { useTheme } from '../theme/ThemeProvider';
import { formatPosition } from '../utils/timeFormat';
import type { RootTabParamList } from '../types';

export default function MiniPlayerBar() {
  const c = useTheme();
  const navigation = useNavigation<NavigationProp<RootTabParamList>>();

  const activeAudioFileId  = usePlaybackStore(s => s.activeAudioFileId);
  const isPlaying          = usePlaybackStore(s => s.isPlaying);
  const currentPosition    = usePlaybackStore(s => s.currentPosition);
  const contentViewVisible = usePlaybackStore(s => s.contentViewVisible);

  const audioFile = useAudioFilesStore(s =>
    activeAudioFileId !== null
      ? s.audioFiles.find(f => f.id === activeAudioFileId)
      : undefined
  );

  // Only show when there is an active file AND ContentView is not on screen.
  if (!activeAudioFileId || contentViewVisible || !audioFile) return null;

  const progress = audioFile.duration > 0
    ? Math.min(currentPosition / audioFile.duration, 1)
    : 0;

  const handleBarPress = () => {
    // Navigate into the Home stack's ContentView for the currently-playing file.
    (navigation as any).navigate('Home', {
      screen: 'ContentView',
      params: { audioFileId: activeAudioFileId },
    });
  };

  return (
    <Pressable
      style={[styles.container, { backgroundColor: c.surface, borderTopColor: c.border }]}
      onPress={handleBarPress}
      android_ripple={{ color: c.primaryLight }}
    >
      {/* Progress line across the very top of the bar */}
      <View style={[styles.progressTrack, { backgroundColor: c.border }]}>
        <View style={[styles.progressFill, { backgroundColor: c.primary, width: `${progress * 100}%` }]} />
      </View>

      <View style={styles.row}>
        <View style={styles.info}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {audioFile.title}
          </Text>
          <Text style={[styles.position, { color: c.textSecondary }]}>
            {formatPosition(currentPosition)}
            {audioFile.duration > 0 ? ` / ${formatPosition(audioFile.duration)}` : ''}
          </Text>
        </View>

        <Pressable
          style={[styles.playBtn, { backgroundColor: c.primary }]}
          onPress={e => {
            e.stopPropagation();
            if (isPlaying) void pause(); else void play();
          }}
          hitSlop={8}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color="#fff"
            style={isPlaying ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 4,
    paddingTop: 8,
  },
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
  },
  progressFill: {
    height: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  position: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
