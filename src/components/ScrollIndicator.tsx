import React, { forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import {
  Animated, StyleSheet, View,
  type NativeSyntheticEvent, type NativeScrollEvent,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../constants/colors';

// A thin, accurate scroll-position indicator. The native scrollbar of a
// virtualized list (FlashList / FlatList) is estimated from measured items and
// drifts on long, variable-height content. This instead derives the thumb size
// and position from the real scroll metrics (contentOffset / contentSize /
// layoutMeasurement) reported on every scroll frame, so it always reflects the
// true position.
//
// Usage: render inside a relatively/absolutely bounded container (the same one
// that bounds the list), wire the list's `onScroll` to the handle's `onScroll`,
// and set `showsVerticalScrollIndicator={false}` on the list.

const MIN_THUMB = 28;
const IDLE_FADE_MS = 900;

export interface ScrollIndicatorHandle {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

const ScrollIndicator = forwardRef<ScrollIndicatorHandle, { rightInset?: number }>(
  ({ rightInset = 2 }, ref) => {
    const c = useTheme();
    const styles = useMemo(() => makeStyles(c), [c]);
    const trackH = useRef(0);
    const top = useRef(new Animated.Value(0)).current;
    const height = useRef(new Animated.Value(MIN_THUMB)).current;
    const opacity = useRef(new Animated.Value(0)).current;
    const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useImperativeHandle(ref, () => ({
      onScroll: e => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        const viewH = layoutMeasurement.height;
        const contentH = contentSize.height;
        if (contentH <= viewH || trackH.current <= 0) return; // nothing to scroll

        const thumbH = Math.max(MIN_THUMB, trackH.current * (viewH / contentH));
        const maxOffset = contentH - viewH;
        const maxTop = trackH.current - thumbH;
        const thumbTop = maxOffset > 0
          ? Math.max(0, Math.min(maxTop, (contentOffset.y / maxOffset) * maxTop))
          : 0;

        height.setValue(thumbH);
        top.setValue(thumbTop);

        // Show while scrolling, fade out after a short idle.
        opacity.setValue(1);
        if (fadeTimer.current) clearTimeout(fadeTimer.current);
        fadeTimer.current = setTimeout(() => {
          // JS driver (not native): top/height are JS-set on the same node, so
          // keeping opacity JS-driven avoids a mixed-driver conflict.
          Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: false }).start();
        }, IDLE_FADE_MS);
      },
    }), [height, opacity, top]);

    return (
      <View
        pointerEvents="none"
        style={[styles.track, { right: rightInset }]}
        onLayout={e => { trackH.current = e.nativeEvent.layout.height; }}
      >
        <Animated.View style={[styles.thumb, { height, top, opacity }]} />
      </View>
    );
  }
);

ScrollIndicator.displayName = 'ScrollIndicator';

export default ScrollIndicator;

function makeStyles(c: Palette) {
  return StyleSheet.create({
    track: {
      position: 'absolute',
      top: 4,
      bottom: 4,
      width: 3,
    },
    thumb: {
      position: 'absolute',
      width: 3,
      borderRadius: 2,
      backgroundColor: c.textSecondary,
    },
  });
}
