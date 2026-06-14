import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getDb } from './src/db';
import { recoverInterruptedTranscriptions } from './src/db/queries/audioFiles';
import { setupAudioMode } from './src/services/audio';
import { checkForUpdate, reloadApp } from './src/services/updates';
import { AppNavigation } from './src/navigation';
import { COLORS } from './src/constants/colors';
import { initLogger, log } from './src/utils/logger';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // First: arm crash capture + freeze watchdog and report whether the
      // PREVIOUS session ended abnormally. Must run before anything else so a
      // crash during init is caught.
      await initLogger();
      try {
        await getDb();        // initialises DB and runs all migrations
        await recoverInterruptedTranscriptions(); // unstick files if the app died mid-transcription
        await setupAudioMode(); // enables background + silent-mode playback
      } catch (e) {
        log.error('startup', 'app init failed', e);
        setError(e instanceof Error ? e.message : 'Failed to initialise app');
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // OTA: on every cold start, quietly check for a newer JS bundle. If one
  // downloads, offer an immediate restart instead of waiting for the silent
  // default (which only applies on the *next* launch — the usual "I pushed an
  // update but nothing changed" confusion). No-op in Expo Go / dev.
  useEffect(() => {
    if (!ready || error) return;
    let cancelled = false;
    void (async () => {
      const result = await checkForUpdate();
      if (cancelled || result.status !== 'downloaded') return;
      Alert.alert(
        '有新版本',
        '已在后台下载完成,立即重启应用以使用最新版本?',
        [
          { text: '稍后', style: 'cancel' },
          { text: '立即重启', onPress: () => { void reloadApp(); } },
        ],
      );
    })();
    return () => { cancelled = true; };
  }, [ready, error]);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppNavigation />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root:      { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  errorText: { color: '#EF4444', fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
});
