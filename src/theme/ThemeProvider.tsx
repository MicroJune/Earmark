import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import { type Palette, lightPalette, darkPalette } from '../constants/colors';
import { getThemeMode, setThemeMode as persistThemeMode, type ThemeMode } from '../services/settings';

// ─── Theme context ────────────────────────────────────────────────────────────
// Holds the user's mode (system / light / dark) and resolves it — using the live
// OS color scheme when mode is 'system' — into the active palette. Persisted via
// settings so the choice survives restarts.
//
// Usage:
//   const c = useTheme();                       // active palette → c.text, c.primary…
//   const styles = useMemo(() => makeStyles(c), [c]);
//   const { mode, scheme, setMode } = useThemeControl();  // for the settings UI

type Scheme = 'light' | 'dark';

interface ThemeContextValue {
  palette: Palette;
  mode: ThemeMode;     // what the user picked
  scheme: Scheme;      // what it resolved to right now
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  palette: lightPalette,
  mode: 'system',
  scheme: 'light',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null — updates live
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load the persisted choice once.
  useEffect(() => { void getThemeMode().then(setModeState); }, []);

  const scheme: Scheme = mode === 'system'
    ? (systemScheme === 'dark' ? 'dark' : 'light')
    : mode;

  const palette = scheme === 'dark' ? darkPalette : lightPalette;

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void persistThemeMode(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ palette, mode, scheme, setMode }),
    [palette, mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The active palette. Re-renders the consumer when the theme changes. */
export function useTheme(): Palette {
  return useContext(ThemeContext).palette;
}

/** Mode + resolved scheme + setter — for the appearance control and status bar. */
export function useThemeControl(): Omit<ThemeContextValue, 'palette'> {
  const { palette: _omit, ...rest } = useContext(ThemeContext);
  return rest;
}
