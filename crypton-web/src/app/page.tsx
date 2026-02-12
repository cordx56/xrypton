"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLock, faKey, faCode } from "@fortawesome/free-solid-svg-icons";

export default function LandingPage() {
  const { isInitialized, privateKeys, userId } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (isInitialized && privateKeys && userId) {
      router.replace("/chat");
    }
  }, [isInitialized, privateKeys, userId, router]);

  // 初期化前・リダイレクト中はフラッシュ防止
  if (!isInitialized || (privateKeys && userId)) {
    return null;
  }

  const features = [
    {
      icon: faLock,
      title: t("landing.feature_e2ee"),
      description: t("landing.feature_e2ee_desc"),
    },
    {
      icon: faKey,
      title: t("landing.feature_pgp"),
      description: t("landing.feature_pgp_desc"),
    },
    {
      icon: faCode,
      title: t("landing.feature_oss"),
      description: t("landing.feature_oss_desc"),
    },
  ];

  return (
    <div className="h-dvh overflow-y-auto flex flex-col bg-bg text-fg">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          {t("app.name")}
        </h1>
        <p className="text-lg text-muted max-w-md mb-8">
          {t("landing.tagline")}
        </p>
        <Link
          href="/chat"
          className="px-6 py-3 rounded-lg bg-accent/80 hover:bg-accent text-white font-semibold transition-colors"
        >
          {t("landing.get_started")}
        </Link>
      </section>

      {/* Features */}
      <section className="px-6 pb-16">
        <div className="max-w-3xl mx-auto grid gap-6 sm:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-accent/20 bg-accent/5 p-6 text-center"
            >
              <FontAwesomeIcon
                icon={feature.icon}
                className="text-3xl text-accent mb-4"
              />
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
