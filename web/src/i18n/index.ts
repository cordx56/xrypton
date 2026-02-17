import { en } from "./en";
import { ja } from "./ja";
import type { Locale, TranslationKeys } from "./types";

export type { Locale, TranslationKeys };

const translations: Record<Locale, TranslationKeys> = { en, ja };

export function translate(locale: Locale, key: keyof TranslationKeys): string {
  return translations[locale][key];
}

export function detectLocale(): Locale {
  if (typeof navigator !== "undefined") {
    const lang = navigator.language.split("-")[0];
    if (lang === "ja") return "ja";
  }
  return "en";
}
