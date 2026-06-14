// ─── Theme palettes ───────────────────────────────────────────────────────────
// The app supports light / dark / follow-system. Both palettes share the SAME
// keys so any component can switch by swapping the palette object (via the
// useTheme() hook). Tune the dark colours here — it's the single source of truth.

export interface Palette {
  primary: string;
  primaryLight: string;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  activeWord: string;
  selectedWord: string;
}

export const lightPalette: Palette = {
  primary:        '#6C63FF',
  primaryLight:   '#EDE9FE',
  background:     '#FFFFFF',
  surface:        '#F9FAFB',
  text:           '#1A1A2E',
  textSecondary:  '#6B7280',
  border:         '#E5E7EB',
  error:          '#EF4444',
  success:        '#10B981',
  warning:        '#F59E0B',
  activeWord:     '#6C63FF',
  selectedWord:   '#EDE9FE',
};

export const darkPalette: Palette = {
  primary:        '#8B83FF', // lifted for contrast on dark surfaces
  primaryLight:   '#2E2A48', // violet-tinted dark surface (chips, highlights)
  background:     '#0F1117',
  surface:        '#1A1C23',
  text:           '#ECECF1',
  textSecondary:  '#9CA3AF',
  border:         '#2A2D36',
  error:          '#F87171',
  success:        '#34D399',
  warning:        '#FBBF24',
  activeWord:     '#8B83FF',
  selectedWord:   '#3A3460',
};

// Legacy default. Components not yet migrated to useTheme() import this and stay
// in light colours until they're converted — so partial migration never breaks
// the build, it just leaves a screen light.
export const COLORS = lightPalette;
