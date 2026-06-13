import { Platform } from 'react-native';
import { log } from '../utils/logger';

// ─── Delete the user's ORIGINAL picked files from public storage ──────────────
// After import we keep a private copy, but the originals stay in Download/etc.
// where the system music app (vivo i音乐, etc.) keeps scanning them — leading to
// a duplicate, out-of-sync media-control card. We offer to delete the originals.
//
// The document picker only grants read access, so we can't unlink public files
// directly. expo-media-library's deleteAssetsAsync shows a single OS confirm
// dialog and removes them. It's a native module (dev build only), require()d
// lazily so Expo Go / web don't crash.

function loadMediaLibrary(): typeof import('expo-media-library') | null {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-media-library');
    return typeof mod?.deleteAssetsAsync === 'function' ? mod : null;
  } catch {
    return null;
  }
}

export function isOriginalCleanupSupported(): boolean {
  return loadMediaLibrary() !== null;
}

/**
 * Attempts to delete the given original files (content:// or file:// URIs from
 * the picker) from public storage. Shows the OS delete-confirmation dialog.
 * Returns how many were deleted. Best-effort — silently no-ops when the module
 * or permission is unavailable.
 */
export async function deleteOriginalFiles(originalUris: string[]): Promise<number> {
  const uris = originalUris.filter(Boolean);
  if (uris.length === 0) return 0;

  const MediaLibrary = loadMediaLibrary();
  if (!MediaLibrary) return 0;

  // Need library permission to resolve URIs into deletable assets.
  const perm = await MediaLibrary.requestPermissionsAsync(false);
  if (!perm.granted) {
    log.info('cleanup', 'media library permission not granted — skipping original cleanup');
    return 0;
  }

  try {
    // deleteAssetsAsync accepts asset objects or string ids/uris; passing the
    // picked URIs directly works on Android (content URIs) and triggers one
    // system confirmation covering all of them.
    await MediaLibrary.deleteAssetsAsync(uris as any);
    log.info('cleanup', `requested deletion of ${uris.length} original file(s)`);
    return uris.length;
  } catch (e) {
    log.warn('cleanup', 'deleteAssetsAsync failed', e instanceof Error ? e.message : String(e));
    return 0;
  }
}
