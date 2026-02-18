"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import NotificationBanner from "@/components/common/NotificationBanner";

type NotificationData = {
  displayName: string;
  iconUrl: string | null;
  userId?: string;
  body: string;
};

type NotificationContextType = {
  showNotification: (data: NotificationData) => void;
};

const NotificationContext = createContext<NotificationContextType>({
  showNotification: () => {},
});

const FADE_OUT_MS = 300;

export const NotificationProvider = ({ children }: { children: ReactNode }) => {
  const [current, setCurrent] = useState<NotificationData | null>(null);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (fadeTimerRef.current) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
  }, []);

  // フェードアウト開始 → アニメーション完了後にアンマウント
  const startFadeOut = useCallback(() => {
    setFading(true);
    fadeTimerRef.current = setTimeout(() => {
      setCurrent(null);
      setFading(false);
      fadeTimerRef.current = null;
    }, FADE_OUT_MS);
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    startFadeOut();
  }, [clearTimers, startFadeOut]);

  const showNotification = useCallback(
    (data: NotificationData) => {
      clearTimers();
      setFading(false);
      setCurrent(data);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startFadeOut();
      }, 3000);
    },
    [clearTimers, startFadeOut],
  );

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}
      {current && (
        <NotificationBanner
          displayName={current.displayName}
          iconUrl={current.iconUrl}
          userId={current.userId}
          body={current.body}
          fading={fading}
          onDismiss={dismiss}
        />
      )}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => useContext(NotificationContext);
