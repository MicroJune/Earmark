import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Storage from 'expo-sqlite/kv-store';
import { log } from '../utils/logger';

// ─── Daily review reminder (local notification, no server) ───────────────────
// Spaced repetition only works if the user actually comes back — a local
// daily notification is the cheapest retention lever a personal tool has.
//
// expo-notifications was gutted in Expo Go (SDK 53+): merely importing it
// initializes a push-token listener that THROWS in Expo Go. So we never import
// it at module load — it's lazily require()d, and only when NOT in Expo Go.
// In Expo Go, reminders are silently unavailable until a development build.

const KEYS = {
  enabled: 'reminder_enabled',
  hour: 'reminder_hour',
  minute: 'reminder_minute',
} as const;

const REMINDER_ID = 'daily-review-reminder';
const CHANNEL_ID = 'review-reminders';

export interface ReminderSettings {
  enabled: boolean;
  hour: number;   // 0-23, local time
  minute: number; // 0-59
}

const DEFAULT_REMINDER: ReminderSettings = { enabled: false, hour: 20, minute: 0 };

// 'storeClient' === Expo Go. Reminders need a development/production build.
export const remindersSupported = Constants.executionEnvironment !== 'storeClient';

let _notifications: typeof import('expo-notifications') | null = null;
let _handlerSet = false;

// Lazily loads expo-notifications, never in Expo Go. Returns null when
// unavailable so callers can no-op gracefully.
function loadNotifications(): typeof import('expo-notifications') | null {
  if (!remindersSupported) return null;
  if (_notifications) return _notifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _notifications = require('expo-notifications');
  } catch {
    return null;
  }
  // Show reminders even when the app is in the foreground (set once).
  if (_notifications && !_handlerSet) {
    _handlerSet = true;
    _notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }
  return _notifications;
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const [enabled, hour, minute] = await Promise.all([
    Storage.getItem(KEYS.enabled),
    Storage.getItem(KEYS.hour),
    Storage.getItem(KEYS.minute),
  ]);
  return {
    enabled: enabled === 'true',
    hour: hour !== null ? Number(hour) : DEFAULT_REMINDER.hour,
    minute: minute !== null ? Number(minute) : DEFAULT_REMINDER.minute,
  };
}

async function ensurePermissionAndChannel(
  Notifications: typeof import('expo-notifications')
): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Review reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return;
  const requested = await Notifications.requestPermissionsAsync();
  if (!requested.granted) {
    throw new Error('Notification permission was denied. Enable it in system settings to get reminders.');
  }
}

/** Enables/disables the daily reminder and (re)schedules it. */
export async function setReminder(settings: ReminderSettings): Promise<void> {
  // Persist the preference regardless — it'll take effect in a dev build.
  await Promise.all([
    Storage.setItem(KEYS.enabled, String(settings.enabled)),
    Storage.setItem(KEYS.hour, String(settings.hour)),
    Storage.setItem(KEYS.minute, String(settings.minute)),
  ]);

  const Notifications = loadNotifications();
  if (!Notifications) {
    if (settings.enabled) {
      throw new Error('Reminders need a development build — Expo Go (SDK 53+) removed notification support. Your preference is saved and will work once you install the dev build.');
    }
    return;
  }

  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});

  if (!settings.enabled) {
    log.info('reminders', 'daily reminder disabled');
    return;
  }

  await ensurePermissionAndChannel(Notifications);
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'Time to review 📚',
      body: 'Your saved phrases are due — a few minutes keeps the streak alive.',
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: settings.hour,
      minute: settings.minute,
    },
  });
  log.info('reminders', `daily reminder scheduled for ${settings.hour}:${String(settings.minute).padStart(2, '0')}`);
}
