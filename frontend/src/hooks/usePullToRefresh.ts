import { useEffect, useRef, useState } from 'react';

interface Options {
  /** Scroll container to watch. Pull only arms when it is at scrollTop 0. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Called once the pull is released past the threshold. */
  onRefresh: () => Promise<unknown>;
  /** Pull distance (px, after resistance) needed to trigger. */
  threshold?: number;
  enabled?: boolean;
}

const RESISTANCE = 0.45;
const MAX_PULL = 110;

/**
 * Pull-to-refresh for the app-shell.
 *
 * The authenticated layout locks document scroll and sets `overscroll-contain`
 * on the inner <main>, which kills the browser's native pull-to-refresh. This
 * reimplements it on the inner scroller.
 *
 * Touch only — on desktop the gesture doesn't exist and Cmd+R already works.
 */
export function usePullToRefresh({ scrollRef, onRefresh, threshold = 64, enabled = true }: Options) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs so the listeners stay non-passive and never re-subscribe mid-gesture.
  const startY = useRef(0);
  const active = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;
    // No coarse pointer => no gesture to support.
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return;
      // Arm only at the very top, otherwise this fights normal scrolling.
      if (el.scrollTop > 0) return;
      active.current = true;
      startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        // Upward move — hand the gesture back to the scroller.
        active.current = false;
        setPull(0);
        return;
      }
      // Content scrolled during the gesture (momentum) — abort.
      if (el.scrollTop > 0) {
        active.current = false;
        setPull(0);
        return;
      }
      if (e.cancelable) e.preventDefault();
      setPull(Math.min(delta * RESISTANCE, MAX_PULL));
    };

    const onTouchEnd = async () => {
      if (!active.current) return;
      active.current = false;
      let shouldRefresh = false;
      setPull(p => {
        shouldRefresh = p >= threshold;
        return shouldRefresh ? threshold : 0;
      });
      if (!shouldRefresh) return;
      refreshingRef.current = true;
      setRefreshing(true);
      try {
        await onRefreshRef.current();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    // touchmove must be non-passive to allow preventDefault.
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollRef, enabled, threshold]);

  return {
    pull,
    refreshing,
    /** 0 → 1 progress toward the threshold. */
    progress: Math.min(pull / threshold, 1),
    armed: pull >= threshold,
  };
}
