"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import BottomTabs from "@/components/layout/BottomTabs";
import GenerateKey from "@/components/GenerateKey";
import Spinner from "@/components/common/Spinner";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const { t } = useI18n();
  const [registerError, setRegisterError] = useState("");
  const [registering, setRegistering] = useState(false);

  const doRegister = () => {
    setRegistering(true);
    setRegisterError("");
    auth
      .register()
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setRegisterError(`${t("auth.register_error")} ${msg}`);
      })
      .finally(() => setRegistering(false));
  };

  // 鍵生成済み・公開鍵導出済み・未登録の場合に自動登録を試みる
  useEffect(() => {
    if (
      auth.isInitialized &&
      auth.publicKeys &&
      auth.userId &&
      !auth.isRegistered &&
      !registering
    ) {
      doRegister();
    }
  }, [auth.isInitialized, auth.publicKeys, auth.userId, auth.isRegistered]);

  // 初期化中
  if (!auth.isInitialized) return null;

  // 鍵またはユーザIDがなければ生成画面を表示
  if (!auth.privateKeys || !auth.userId) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center p-6">
        <p className="mb-4 text-center">{t("auth.init_message")}</p>
        <GenerateKey />
      </div>
    );
  }

  // 公開鍵導出中 or 登録中
  if (!auth.publicKeys || (registering && !auth.isRegistered)) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center p-6">
        <Spinner />
        <p className="mt-4 text-center text-muted">
          {!auth.publicKeys ? t("common.loading") : t("auth.registering")}
        </p>
      </div>
    );
  }

  // 登録失敗
  if (!auth.isRegistered && registerError) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center p-6">
        <p className="mb-4 text-center text-red-500">{registerError}</p>
        <button
          type="button"
          className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50"
          onClick={doRegister}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  // 未登録（公開鍵導出待ちなど）
  if (!auth.isRegistered) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center p-6">
        <Spinner />
        <p className="mt-4 text-center text-muted">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col">
      <div className="flex-1 overflow-hidden">{children}</div>
      <BottomTabs />
    </div>
  );
}
