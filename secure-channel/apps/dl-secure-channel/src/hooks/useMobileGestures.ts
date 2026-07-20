import { useEffect, useRef, useCallback } from 'react';

/**
 * Detects a right-edge swipe gesture and calls `onSwipeBack`.
 * Only active on touch devices at ≤768px viewport width.
 */
export function useSwipeBack(onSwipeBack: () => void) {
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (window.innerWidth > 768) return;
    const touch = e.touches[0];
    // Only trigger from the left edge (first 30px)
    if (touch.clientX < 30) {
      touchStart.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStart.current) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = Math.abs(touch.clientY - touchStart.current.y);
    const elapsed = Date.now() - touchStart.current.time;
    touchStart.current = null;

    // Require: horizontal swipe > 80px, vertical drift < 75px, within 400ms
    if (dx > 80 && dy < 75 && elapsed < 400) {
      onSwipeBack();
    }
  }, [onSwipeBack]);

  useEffect(() => {
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchEnd]);
}

/**
 * Returns handlers for long-press on touch (opens context menu).
 * Falls back to onContextMenu on non-touch.
 */
export function useLongPress(onLongPress: (e: React.TouchEvent | React.MouseEvent) => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    firedRef.current = false;
    const touch = e.touches[0];
    touchRef.current = { x: touch.clientX, y: touch.clientY };
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress(e);
    }, delay);
  }, [onLongPress, delay]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchRef.current.x);
    const dy = Math.abs(touch.clientY - touchRef.current.y);
    if (dx > 10 || dy > 10) clear();
  }, [clear]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    clear();
    // Prevent the tap from firing if long-press already triggered
    if (firedRef.current) {
      e.preventDefault();
    }
  }, [clear]);

  return { onTouchStart, onTouchMove, onTouchEnd };
}
