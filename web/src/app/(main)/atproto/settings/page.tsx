"use client";

import { useState } from "react";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import AtprotoLogin from "@/components/atproto/AtprotoLogin";
import Spinner from "@/components/common/Spinner";

export default function AtprotoSettingsPage() {
  const { isConnected, isLoading, did, handle, accounts, refreshAccounts } =
    useAtproto();
  const { getSignedMessage } = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [unlinking, setUnlinking] = useState<string | null>(null);

  const handleUnlink = async (targetDid: string) => {
    setUnlinking(targetDid);
    try {
      const signed = await getSignedMessage();
      if (!signed) return;
      await authApiClient(signed.signedMessage).atproto.unlinkAccount(
        targetDid,
      );
      await refreshAccounts();
    } catch (e) {
      showError(e instanceof Error ? e.message : t("error.unknown"));
    } finally {
      setUnlinking(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h1 className="text-xl font-bold">{t("atproto.settings")}</h1>

      {/* Connection status */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted">
          {t("atproto.connect")}
        </h2>
        {isConnected ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-panel">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-sm">{handle ?? did}</span>
          </div>
        ) : (
          <AtprotoLogin />
        )}
      </section>

      {/* Linked accounts */}
      {accounts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted">
            {t("atproto.linked_accounts")}
          </h2>
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.atproto_did}
                className="flex items-center justify-between p-3 rounded-lg bg-panel"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {account.atproto_handle ?? account.atproto_did}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {account.atproto_did}
                  </p>
                  <p className="text-xs text-muted truncate">
                    {account.pds_url}
                  </p>
                </div>
                <button
                  onClick={() => handleUnlink(account.atproto_did)}
                  disabled={unlinking === account.atproto_did}
                  className="ml-2 px-3 py-1 text-xs rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {unlinking === account.atproto_did
                    ? t("common.loading")
                    : t("atproto.unlink_account")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Privacy notice */}
      <section className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
        <p className="text-xs text-yellow-400/80">
          {t("atproto.privacy_notice")}
        </p>
      </section>
    </div>
  );
}
