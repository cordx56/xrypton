import { useRef, useCallback } from "react";

/**
 * 長押し（タッチ）および右クリック（デスクトップ）を検知するフック。
 * 返却される longPressedRef を onClick 側で参照し、長押し発火後のクリックを無視する。
 */
export function useLongPress(onLongPress: () => void, ms = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressedRef = useRef(false);

  const onTouchStart = useCallback(() => {
    longPressedRef.current = false;
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onLongPress();
    },
    [onLongPress],
  );

  return {
    onTouchStart,
    onTouchEnd: clear,
    onTouchCancel: clear,
    onContextMenu,
    longPressedRef,
  };
}
