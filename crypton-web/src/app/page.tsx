"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faLock,
  faKey,
  faCode,
  faNetworkWired,
} from "@fortawesome/free-solid-svg-icons";

function LandingPageContent() {
  const { isInitialized, privateKeys, userId } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceLanding = searchParams.has("landing");

  useEffect(() => {
    if (!forceLanding && isInitialized && privateKeys && userId) {
      router.replace("/chat");
    }
  }, [isInitialized, privateKeys, userId, router, forceLanding]);

  // 初期化前・リダイレクト中はフラッシュ防止（landing指定時は常に表示）
  if (!forceLanding && (!isInitialized || (privateKeys && userId))) {
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
      icon: faNetworkWired,
      title: t("landing.feature_distributed"),
      description: t("landing.feature_distributed_desc"),
    },
    {
      icon: faCode,
      title: t("landing.feature_oss"),
      description: t("landing.feature_oss_desc"),
      href: "https://github.com/cordx56/crypton",
    },
  ];

  return (
    <div className="h-dvh overflow-y-auto flex flex-col bg-bg text-fg">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="text-5xl font-bold tracking-tight mb-4">
          {t("app.name")}
        </h1>
        <p className="text-lg text-muted max-w-lg mb-8">
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
        <div className="max-w-4xl mx-auto grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => {
            const content = (
              <>
                <FontAwesomeIcon
                  icon={feature.icon}
                  className="text-3xl text-accent mb-4"
                />
                <h3 className="font-semibold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted">{feature.description}</p>
              </>
            );
            return feature.href ? (
              <a
                key={feature.title}
                href={feature.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-accent/20 bg-accent/5 p-6 text-center hover:bg-accent/10 transition-colors"
              >
                {content}
              </a>
            ) : (
              <div
                key={feature.title}
                className="rounded-xl border border-accent/20 bg-accent/5 p-6 text-center"
              >
                {content}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense>
      <LandingPageContent />
    </Suspense>
  );
}
