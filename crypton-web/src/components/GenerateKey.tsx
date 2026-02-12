"use client";

import { useState } from "react";
import { z } from "zod";
import { WorkerCallMessage, UserId } from "@/utils/schema";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { useI18n } from "@/contexts/I18nContext";
import { apiClient, ApiError } from "@/api/client";
import Dialog from "@/components/common/Dialog";
import Code from "@/components/Code";
import QrReader from "@/components/QrReader";

const GenerateKey = () => {
  const {
    worker,
    setPrivateKeys,
    setSubPassphrase,
    setUserId: setAuthUserId,
  } = useAuth();
  const { pushDialog } = useDialogs();
  const { showError } = useErrorToast();
  const { t } = useI18n();

  const [importMode, setImportMode] = useState(false);
  const [userId, setUserId] = useState("");
  const [mainPassphrase, setMainPassphrase] = useState("");
  const [subPassphrase, setSubPassphraseLocal] = useState("");
  const [saveSubPass, setSaveSubPass] = useState(true);
  const [armoredKey, setArmoredKey] = useState("");

  const generate = () => {
    if (!worker) return;
    if (!UserId.safeParse(userId).success) {
      showError(t("error.invalid_user_id"));
      return;
    }
    (async () => {
      // ユーザIDが既に登録済みか確認
      try {
        await apiClient().user.getKeys(userId);
        // 成功 = ユーザが存在する
        showError(t("auth.user_exists"));
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) {
          showError(t("error.network"));
          return;
        }
        // 404 = 未登録なので続行
      }

      const message: z.infer<typeof WorkerCallMessage> = {
        call: "generate",
        userId,
        mainPassphrase,
        subPassphrase,
      };
      worker.eventWaiter("generate", (data) => {
        if (!data.success) return;

        setPrivateKeys(data.data.keys);
        setAuthUserId(userId);
        if (saveSubPass) {
          setSubPassphrase(subPassphrase);
        }
        pushDialog((p) => (
          <Dialog {...p} title="Generated Keys">
            <Code code={data.data.keys} />
          </Dialog>
        ));
      });
      worker.postMessage(message);
    })();
  };

  const importKey = () => {
    if (!worker) return;
    if (!UserId.safeParse(userId).success) {
      showError(t("error.invalid_user_id"));
      return;
    }
    const trimmedKey = armoredKey.trim();
    if (!trimmedKey.startsWith("-----BEGIN PGP PRIVATE KEY BLOCK-----")) {
      showError(t("error.invalid_key_format"));
      return;
    }
    (async () => {
      // ユーザIDが既に登録済みか確認（404なら続行）
      try {
        await apiClient().user.getKeys(userId);
        // 成功 = ユーザが存在するが、インポートの場合は既存ユーザのキーを復元するケースもあるので続行
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) {
          showError(t("error.network"));
          return;
        }
        // 404 = 未登録なので続行
      }

      // パスフレーズ検証
      const validated = await new Promise<boolean>((resolve) => {
        worker.eventWaiter("validate_passphrases", (data) => {
          resolve(data.success);
        });
        worker.postMessage({
          call: "validate_passphrases",
          privateKeys: trimmedKey,
          mainPassphrase,
          subPassphrase,
        });
      });
      if (!validated) {
        showError(t("error.passphrase_validation_failed"));
        return;
      }

      setPrivateKeys(trimmedKey);
      setAuthUserId(userId);
      if (saveSubPass) {
        setSubPassphrase(subPassphrase);
      }
    })();
  };

  return (
    <div>
      {/* モード切替 */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          className={`px-4 py-2 rounded font-medium ${
            !importMode
              ? "bg-accent/30"
              : "border border-accent/30 hover:bg-accent/10"
          }`}
          onClick={() => setImportMode(false)}
        >
          {t("auth.generate")}
        </button>
        <button
          type="button"
          className={`px-4 py-2 rounded font-medium ${
            importMode
              ? "bg-accent/30"
              : "border border-accent/30 hover:bg-accent/10"
          }`}
          onClick={() => setImportMode(true)}
        >
          {t("auth.import_key")}
        </button>
      </div>

      {/* 共通フィールド */}
      {(() => {
        const commonFields = (
          <>
            <div className="col-span-3 sm:col-span-1">
              {t("auth.user_id")}:
            </div>
            <div className="col-span-3 sm:col-span-2">
              <input
                className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              />
            </div>
            <div className="col-span-3 sm:col-span-1">
              {t("auth.main_passphrase")}:
            </div>
            <div className="col-span-3 sm:col-span-2">
              <input
                className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
                type="password"
                value={mainPassphrase}
                onChange={(e) => setMainPassphrase(e.target.value)}
              />
            </div>
            <div className="col-span-3 sm:col-span-1">
              {t("auth.sub_passphrase")}:
            </div>
            <div className="col-span-3 sm:col-span-2">
              <input
                className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
                type="password"
                value={subPassphrase}
                onChange={(e) => setSubPassphraseLocal(e.target.value)}
              />
            </div>
            <div className="col-span-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={saveSubPass}
                  onChange={(e) => setSaveSubPass(e.target.checked)}
                />
                {t("auth.save_passphrase")}
              </label>
            </div>
          </>
        );

        return importMode ? (
          /* インポートフォーム */
          <div className="grid grid-cols-3 gap-4 items-center">
            <div className="col-span-3">
              <textarea
                className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent resize-none font-mono text-xs"
                rows={6}
                value={armoredKey}
                onChange={(e) => setArmoredKey(e.target.value)}
                placeholder={t("auth.import_key_placeholder")}
              />
            </div>
            <div className="col-span-3">
              <QrReader setData={setArmoredKey} />
            </div>
            {commonFields}
            <div className="col-span-3 mt-2">
              <button
                className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
                type="button"
                onClick={importKey}
              >
                {t("auth.import_key")}
              </button>
            </div>
          </div>
        ) : (
          /* 生成フォーム */
          <div className="grid grid-cols-3 gap-4 items-center">
            {commonFields}
            <div className="col-span-3 mt-2">
              <button
                className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
                type="button"
                onClick={generate}
              >
                {t("auth.generate")}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default GenerateKey;
