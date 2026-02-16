import type { Locale } from "@/i18n/types";

export type NavItem = {
  slug: string;
  label: string;
};

const nav: Record<Locale, NavItem[]> = {
  en: [
    { slug: "", label: "Home" },
    { slug: "getting-started", label: "Getting Started" },
    { slug: "security", label: "Security" },
    { slug: "custom-domain", label: "Custom Domain" },
  ],
  ja: [
    { slug: "", label: "ホーム" },
    { slug: "getting-started", label: "はじめに" },
    { slug: "security", label: "セキュリティ" },
    { slug: "custom-domain", label: "カスタムドメイン" },
  ],
};

export default nav;
