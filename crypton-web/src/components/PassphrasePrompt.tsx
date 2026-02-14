"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { useI18n } from "@/contexts/I18nContext";
import Spinner from "@/components/common/Spinner";

const PassphrasePrompt = () => {
  const auth = useAuth();
  const { showError } = useErrorToast();
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [verifying, setVerifying] = useState(false);

  if (!auth.worker) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input || !auth.worker || !auth.privateKeys || verifying) return;

    setVerifying(true);
    const { eventWaiter, postMessage } = auth.worker;

    // ダミーペイロードで署名を試み、パスフレーズの正当性を検証
    eventWaiter("sign", (result) => {
      if (result.success) {
        auth.setSubPassphraseSession(input);
      } else {
        showError(t("error.invalid_sub_passphrase"));
      }
      setVerifying(false);
    });

    postMessage({
      call: "sign",
      keys: auth.privateKeys,
      passphrase: input,
      payload: JSON.stringify({ verify: true }),
    });
  };

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center p-6">
        <h2 className="text-lg font-semibold mb-2">
          {t("auth.enter_sub_passphrase")}
        </h2>
        <p className="text-muted mb-6 text-center">
          {t("auth.sub_passphrase_required")}
        </p>
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm flex flex-col gap-4"
        >
          <input
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="px-6 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium disabled:opacity-50"
            disabled={!input || verifying}
          >
            {verifying ? <Spinner /> : t("common.ok")}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PassphrasePrompt;
