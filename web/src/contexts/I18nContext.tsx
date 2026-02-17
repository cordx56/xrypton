"use client";

import { createContext, useContext, useEffect, ReactNode } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { translate, detectLocale } from "@/i18n";
import type { Locale, TranslationKeys } from "@/i18n";

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: keyof TranslationKeys) => string;
};

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {},
  t: (key) => key,
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  // SSR一致のため静的デフォルトを使用し、マウント後にブラウザ言語を検出
  const [locale, setLocale] = useLocalStorage<Locale>("locale", "en");

  useEffect(() => {
    const stored = window.localStorage.getItem("locale");
    if (!stored) {
      setLocale(detectLocale());
    }
  }, []);

  const t = (key: keyof TranslationKeys) => translate(locale, key);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => useContext(I18nContext);
