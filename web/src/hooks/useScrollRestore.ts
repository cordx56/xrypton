"use client";

import { useRef, useEffect, type RefObject } from "react";

/** ページ遷移をまたいでスクロール位置を保持するキャッシュ */
const scrollCache = new Map<string, number>();

/** スクロール位置の保存と復元を行うフック。
 *  `ready` が true になった最初のレンダー後にキャッシュから復元し、
 *  以降はスクロールイベントで位置を保存し続ける。 */
export function useScrollRestore(
  key: string,
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const restored = useRef(false);

  // スクロール位置をキャッシュに保存
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => scrollCache.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key, ref]);

  // データ復元後にスクロール位置を復元
  useEffect(() => {
    if (ready && !restored.current && ref.current) {
      const saved = scrollCache.get(key);
      if (saved !== undefined) {
        requestAnimationFrame(() => {
          if (ref.current) ref.current.scrollTop = saved;
        });
      }
      restored.current = true;
    }
  }, [ready, key, ref]);
}
