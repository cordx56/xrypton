"use client";

import { useCallback } from "react";
import { useDialogs } from "@/contexts/DialogContext";

/**
 * pushDialog を Promise でラップし、OK/Cancel の結果を返すフック。
 * ダイアログコンテンツは呼び出し側が自由に構成できる。
 */
export function useConfirmDialog() {
  const { pushDialog } = useDialogs();

  /** ダイアログを表示し、OK なら true、Cancel/dismiss なら false を返す */
  const confirm = useCallback(
    (
      render: (props: {
        ok: () => void;
        cancel: () => void;
        close: () => void;
        setOnClose: (fn: () => void) => void;
      }) => React.ReactNode,
    ): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        let settled = false;
        const settle = (value: boolean) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        pushDialog((p) => {
          // オーバーレイクリック時は Cancel 扱い
          p.setOnClose(() => {
            settle(false);
            p.close();
          });

          return render({
            ok: () => {
              settle(true);
              p.close();
            },
            cancel: () => {
              settle(false);
              p.close();
            },
            close: p.close,
            setOnClose: p.setOnClose,
          }) as React.ReactElement;
        });
      }),
    [pushDialog],
  );

  return { confirm };
}
