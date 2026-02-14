"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import BottomTabs from "@/components/layout/BottomTabs";
import GlobalHeader from "@/components/layout/GlobalHeader";
import GenerateKey from "@/components/GenerateKey";
import PassphrasePrompt from "@/components/PassphrasePrompt";
import AccountList from "@/components/layout/AccountList";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const { t } = useI18n();

  // 初期化中
  if (!auth.isInitialized) return null;

  // 鍵またはユーザIDがない、または未登録の場合は生成画面を表示
  if (!auth.privateKeys || !auth.userId || !auth.isRegistered) {
    return (
      <div className="h-dvh overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center p-6">
          <p className="mb-4 text-center">{t("auth.init_message")}</p>
          <GenerateKey mode="init" />
          {auth.accountIds.length > 0 && (
            <div className="mt-8 w-full max-w-lg">
              <h3 className="text-sm font-medium text-muted mb-2 px-4">
                {t("account.logged_in")}
              </h3>
              <AccountList accountIds={auth.accountIds} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // サブパスフレーズが未設定（IDBに保存しなかったケースのリロード時）
  if (!auth.subPassphrase) {
    return <PassphrasePrompt />;
  }

  return (
    <div className="h-dvh flex flex-col">
      <GlobalHeader />
      <div className="flex-1 overflow-y-auto">{children}</div>
      <BottomTabs />
    </div>
  );
}
