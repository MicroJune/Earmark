import * as Updates from 'expo-updates';
import { log } from '../utils/logger';

// Thin wrapper around expo-updates (EAS Update / OTA).
//
// Default OTA behaviour is "silent background download, apply next launch",
// which makes testing confusing (no notification, changes only appear after a
// second cold start). This module lets the app check + download explicitly and
// reload immediately, and exposes the running version for the Settings page.
//
// In Expo Go and dev-client builds `Updates.isEnabled` is false and the check
// APIs throw — every entry point guards on it.

export interface UpdateInfo {
  enabled: boolean;            // false in Expo Go / __DEV__ — OTA not active
  runtimeVersion: string | null;
  channel: string | null;
  updateId: string | null;     // null when running the build-time embedded bundle
  isEmbedded: boolean;         // true = running embedded bundle (no OTA applied yet)
  createdAt: Date | null;      // when the running update was published
}

export function getUpdateInfo(): UpdateInfo {
  return {
    enabled: Updates.isEnabled,
    runtimeVersion: Updates.runtimeVersion ?? null,
    channel: Updates.channel ?? null,
    updateId: Updates.updateId ?? null,
    isEmbedded: Updates.isEmbeddedLaunch,
    createdAt: Updates.createdAt ?? null,
  };
}

export type CheckResult =
  | { status: 'disabled' }     // not an OTA-capable build
  | { status: 'up-to-date' }   // server has nothing newer
  | { status: 'downloaded' }   // a new update was fetched and is ready to apply
  | { status: 'error'; message: string };

/**
 * Checks the server for a newer update and, if found, downloads it. Returns
 * 'downloaded' only when a genuinely new bundle is now staged for the next
 * reload. Never throws — failures come back as { status: 'error' }.
 */
export async function checkForUpdate(): Promise<CheckResult> {
  if (!Updates.isEnabled) return { status: 'disabled' };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { status: 'up-to-date' };
    const fetched = await Updates.fetchUpdateAsync();
    return fetched.isNew ? { status: 'downloaded' } : { status: 'up-to-date' };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn('updates', 'check/fetch failed', message);
    return { status: 'error', message };
  }
}

/** Restarts the app onto the most recently downloaded update. */
export async function reloadApp(): Promise<void> {
  await Updates.reloadAsync();
}
