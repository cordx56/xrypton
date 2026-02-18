"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type RefObject,
} from "react";

const THRESHOLD = 60;

/** スクロールコンテナの最上部でプルダウンした際にリフレッシュをトリガーするフック。
 *  タッチ操作とホイール操作の両方に対応する。 */
export function usePullToRefresh(
  scrollRef: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // タッチ操作の開始Y座標
  const touchStartY = useRef(0);
  // プル中かどうか（scrollTop === 0 でタッチ開始した場合のみ有効）
  const pulling = useRef(false);
  // 二重リフレッシュ防止
  const refreshingRef = useRef(false);

  const triggerRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setPullDistance(0);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [onRefresh]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // overscroll-behavior でブラウザネイティブのプルダウン更新を抑止
    const prev = el.style.overscrollBehavior;
    el.style.overscrollBehavior = "contain";

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (el.scrollTop <= 0) {
        pulling.current = true;
        touchStartY.current = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || refreshingRef.current) return;
      // スクロール途中でプルが始まった場合は無効化
      if (el.scrollTop > 0) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }
      const dy = e.touches[0].clientY - touchStartY.current;
      if (dy > 0) {
        // 抵抗感を出すために距離を減衰
        setPullDistance(Math.min(dy * 0.4, THRESHOLD * 2));
        e.preventDefault();
      } else {
        setPullDistance(0);
      }
    };

    const onTouchEnd = () => {
      if (!pulling.current) return;
      pulling.current = false;
      const dist = pullDistanceRef.current;
      if (dist >= THRESHOLD) {
        triggerRefresh();
      } else {
        setPullDistance(0);
      }
    };

    // ホイール操作: scrollTop === 0 で上方向ホイール
    let wheelAccum = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (e: WheelEvent) => {
      if (refreshingRef.current) return;
      if (el.scrollTop > 0) {
        wheelAccum = 0;
        return;
      }
      if (e.deltaY < 0) {
        wheelAccum += Math.abs(e.deltaY);
        const dist = Math.min(wheelAccum * 0.3, THRESHOLD * 2);
        setPullDistance(dist);

        if (wheelTimer) clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => {
          if (wheelAccum * 0.3 >= THRESHOLD) {
            triggerRefresh();
          } else {
            setPullDistance(0);
          }
          wheelAccum = 0;
        }, 150);
      } else {
        wheelAccum = 0;
        setPullDistance(0);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      el.style.overscrollBehavior = prev;
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, [scrollRef, triggerRefresh]);

  // pullDistance の最新値を ref で保持（touchend ハンドラ内で参照するため）
  const pullDistanceRef = useRef(pullDistance);
  pullDistanceRef.current = pullDistance;

  return { pullDistance, refreshing, threshold: THRESHOLD };
}
