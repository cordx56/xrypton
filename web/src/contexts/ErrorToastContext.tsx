"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import ErrorToast from "@/components/common/ErrorToast";

type ErrorToastContextType = {
  showError: (message: string) => void;
};

const ErrorToastContext = createContext<ErrorToastContextType>({
  showError: () => {},
});

const FADE_OUT_MS = 300;

export const ErrorToastProvider = ({ children }: { children: ReactNode }) => {
  const [message, setMessage] = useState<string | null>(null);
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

  const startFadeOut = useCallback(() => {
    setFading(true);
    fadeTimerRef.current = setTimeout(() => {
      setMessage(null);
      setFading(false);
      fadeTimerRef.current = null;
    }, FADE_OUT_MS);
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    startFadeOut();
  }, [clearTimers, startFadeOut]);

  const showError = useCallback(
    (msg: string) => {
      clearTimers();
      setFading(false);
      setMessage(msg);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        startFadeOut();
      }, 5000);
    },
    [clearTimers, startFadeOut],
  );

  return (
    <ErrorToastContext.Provider value={{ showError }}>
      {children}
      {message && (
        <ErrorToast message={message} fading={fading} onDismiss={dismiss} />
      )}
    </ErrorToastContext.Provider>
  );
};

export const useErrorToast = () => useContext(ErrorToastContext);
