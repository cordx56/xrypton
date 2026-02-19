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
    { slug: "atproto", label: "AT Protocol" },
    { slug: "external-accounts", label: "External Accounts" },
    { slug: "wot", label: "Web of Trust" },
    { slug: "custom-domain", label: "Custom Domain" },
  ],
  ja: [
    { slug: "", label: "ホーム" },
    { slug: "getting-started", label: "はじめに" },
    { slug: "security", label: "セキュリティ" },
    { slug: "atproto", label: "AT Protocol" },
    { slug: "external-accounts", label: "外部アカウント連携" },
    { slug: "wot", label: "Web of Trust" },
    { slug: "custom-domain", label: "カスタムドメイン" },
  ],
};

export default nav;
