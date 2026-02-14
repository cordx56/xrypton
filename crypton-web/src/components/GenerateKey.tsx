"use client";

import { useEffect, useState, useCallback } from "react";
import { z } from "zod";
import { WorkerCallMessage, UserId } from "@/utils/schema";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { useI18n } from "@/contexts/I18nContext";
import { useDialogs } from "@/contexts/DialogContext";
import { apiClient, authApiClient, ApiError } from "@/api/client";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";
import QrReader from "@/components/QrReader";
import Dialog from "@/components/common/Dialog";
import Spinner from "@/components/common/Spinner";

type GenerateKeyMode = "init" | "settings";

const MIN_LENGTH = 4;

const GenerateKey = ({ mode = "init" }: { mode?: GenerateKeyMode }) => {
  const auth = useAuth();
  const { worker, activateAccount } = auth;
  const { showError } = useErrorToast();
  const { t } = useI18n();
  const { pushDialog } = useDialogs();

  const [importMode, setImportMode] = useState(false);
  const [userId, setUserId] = useState("");
  const [mainPassphrase, setMainPassphrase] = useState("");
  const [subPassphrase, setSubPassphraseLocal] = useState("");
  const [saveSubPass, setSaveSubPass] = useState(true);
  const [armoredKey, setArmoredKey] = useState("");
  const [processing, setProcessing] = useState(false);

  // 登録完了後に表示する秘密鍵（export画面用）
  const [completedKeys, setCompletedKeys] = useState<string | null>(null);

  const isUpdateMode =
    mode === "settings" && !!auth.userId && auth.isRegistered;

  const isAddAccountFlow = mode === "init" && auth.isAddingAccount;

  useEffect(() => {
    if (isUpdateMode && auth.userId) {
      setUserId(auth.userId);
    }
  }, [isUpdateMode, auth.userId]);

  // インポート時: 鍵からユーザIDを自動抽出
  useEffect(() => {
    if (
      !worker ||
      !armoredKey.trim().startsWith("-----BEGIN PGP PRIVATE KEY BLOCK-----")
    )
      return;
    worker.eventWaiter("get_private_key_user_ids", (data) => {
      if (!data.success || data.data.user_ids.length === 0) return;
      // PGP鍵のユーザIDは "user@hostname" 形式なので@以前をローカルIDとして使用
      setUserId(data.data.user_ids[0].split("@")[0]);
    });
    worker.postMessage({
      call: "get_private_key_user_ids",
      privateKeys: armoredKey.trim(),
    });
  }, [worker, armoredKey]);

  const exportPublicKeys = useCallback(
    (keys: string) => {
      if (!worker) return Promise.resolve(null);
      return new Promise<string | null>((resolve) => {
        worker.eventWaiter("export_public_keys", (data) => {
          resolve(data.success ? data.data.keys : null);
        });
        worker.postMessage({ call: "export_public_keys", keys });
      });
    },
    [worker],
  );

  // WebAuthn登録 → サーバ登録を行う共通処理
  const registerAccount = useCallback(
    async (targetUserId: string, publicKeys: string) => {
      // WebAuthn登録
      const webauthnOk = await auth.registerWebAuthn(targetUserId);
      if (!webauthnOk) {
        throw new Error("webauthn_failed");
      }

      // ローカルサーバへの登録はドメインなしのユーザIDを使用
      try {
        await apiClient().user.postKeys(targetUserId, publicKeys, publicKeys);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // post_keysの409は既存ユーザ検知として十分
        } else {
          throw e;
        }
      }
    },
    [auth],
  );

  const generate = () => {
    if (!worker || processing) return;
    const targetUserId = isUpdateMode ? auth.userId! : userId;
    if (!UserId.safeParse(targetUserId).success) {
      showError(t("error.invalid_user_id"));
      return;
    }
    if (targetUserId.includes("@")) {
      showError(t("error.invalid_user_id"));
      return;
    }
    if (
      mainPassphrase.length < MIN_LENGTH ||
      subPassphrase.length < MIN_LENGTH
    ) {
      showError(t("error.min_length"));
      return;
    }
    setProcessing(true);
    (async () => {
      // 鍵生成時: userId + @hostname でWASM workerに渡す
      const hostname = window.location.host;
      const fullUserId = `${targetUserId}@${hostname}`;

      const message: z.infer<typeof WorkerCallMessage> = {
        call: "generate",
        userId: fullUserId,
        mainPassphrase,
        subPassphrase,
      };
      worker.eventWaiter("generate", async (data) => {
        if (!data.success) {
          setProcessing(false);
          return;
        }

        const generatedKeys = data.data.keys;

        if (isUpdateMode) {
          // 鍵更新フロー（既存と同じ）
          const publicKeys = await exportPublicKeys(generatedKeys);
          if (!publicKeys) {
            showError(t("error.unknown"));
            setProcessing(false);
            return;
          }
          try {
            await auth.updateKeys(publicKeys);
          } catch (e) {
            if (e instanceof ApiError) {
              if (e.status === 401) showError(t("error.unauthorized"));
              else if (e.status === 403) showError(t("error.forbidden"));
              else if (e.status === 404) showError(t("error.not_found"));
              else showError(t("error.unknown"));
            } else if (
              e instanceof Error &&
              e.message === "WebAuthn verification failed"
            ) {
              showError(t("error.webauthn_failed"));
            } else {
              showError(t("error.network"));
            }
            setProcessing(false);
            return;
          }
          auth.setPrivateKeys(generatedKeys);
          if (saveSubPass) {
            auth.setSubPassphrase(subPassphrase);
          } else {
            auth.setSubPassphraseSession(subPassphrase);
          }
          setCompletedKeys(generatedKeys);
          setProcessing(false);
          return;
        }

        // 新規登録フロー: 保存（リロードなし）→ 公開鍵導出 → WebAuthn → サーバ登録
        await activateAccount(
          targetUserId,
          generatedKeys,
          saveSubPass ? subPassphrase : undefined,
          true, // skipReload
        );
        if (!saveSubPass) {
          auth.setSubPassphraseSession(subPassphrase);
        }

        const publicKeys = await exportPublicKeys(generatedKeys);
        if (!publicKeys) {
          showError(t("error.unknown"));
          setProcessing(false);
          return;
        }

        try {
          await registerAccount(targetUserId, publicKeys);
        } catch (e) {
          if (e instanceof Error && e.message === "webauthn_failed") {
            showError(t("error.webauthn_failed"));
          } else if (e instanceof Error && e.message === "key_mismatch") {
            showError(t("auth.key_mismatch"));
          } else {
            showError(t("auth.register_error"));
          }
          setProcessing(false);
          return;
        }

        // markRegistered は handleContinue で呼ぶ（ここで呼ぶと
        // isRegistered=true で layout が GenerateKey をアンマウントし、
        // エクスポート画面が表示されない）
        setCompletedKeys(generatedKeys);
        setProcessing(false);
      });
      worker.postMessage(message);
    })();
  };

  const importKey = () => {
    if (!worker || processing) return;
    if (!UserId.safeParse(userId).success) {
      showError(t("error.invalid_user_id"));
      return;
    }
    if (userId.includes("@")) {
      showError(t("error.invalid_user_id"));
      return;
    }
    if (
      mainPassphrase.length < MIN_LENGTH ||
      subPassphrase.length < MIN_LENGTH
    ) {
      showError(t("error.min_length"));
      return;
    }
    const trimmedKey = armoredKey.trim();
    if (!trimmedKey.startsWith("-----BEGIN PGP PRIVATE KEY BLOCK-----")) {
      showError(t("error.invalid_key_format"));
      return;
    }
    setProcessing(true);
    (async () => {
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
        setProcessing(false);
        return;
      }

      // 保存（リロードなし）
      await activateAccount(
        userId,
        trimmedKey,
        saveSubPass ? subPassphrase : undefined,
        true, // skipReload
      );
      if (!saveSubPass) {
        auth.setSubPassphraseSession(subPassphrase);
      }

      // 秘密鍵を保有しているため認証付きgetKeysで存在確認
      let isExistingUser = false;
      const signed = await auth.getSignedMessage();
      if (signed) {
        try {
          const client = authApiClient(signed.signedMessage);
          await client.user.getKeys(userId);
          isExistingUser = true;
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) {
            showError(t("error.network"));
            setProcessing(false);
            return;
          }
        }
      }

      if (isExistingUser) {
        // 既存ユーザのキー復元 → サーバ登録不要、そのままリロード
        await auth.markRegistered();
        window.location.reload();
        return;
      }

      // 新規ユーザ → WebAuthn + サーバ登録
      const publicKeys = await exportPublicKeys(trimmedKey);
      if (!publicKeys) {
        showError(t("error.unknown"));
        setProcessing(false);
        return;
      }

      try {
        await registerAccount(userId, publicKeys);
      } catch (e) {
        if (e instanceof Error && e.message === "webauthn_failed") {
          showError(t("error.webauthn_failed"));
        } else if (e instanceof Error && e.message === "key_mismatch") {
          showError(t("auth.key_mismatch"));
        } else {
          showError(t("auth.register_error"));
        }
        setProcessing(false);
        return;
      }

      setCompletedKeys(trimmedKey);
      setProcessing(false);
    })();
  };

  const openExportDialog = (keys: string) => {
    pushDialog((p) => (
      <Dialog {...p} title={t("profile.export_private_keys")}>
        <QrDisplay data={keys} />
        <Code code={keys} />
      </Dialog>
    ));
  };

  const handleContinue = async () => {
    await auth.markRegistered();
    window.location.reload();
  };

  // 登録完了画面
  if (completedKeys) {
    return (
      <div className="flex flex-col items-center gap-6 max-w-lg w-full mx-auto">
        <h2 className="text-lg font-semibold">
          {t("auth.registration_complete")}
        </h2>
        <p className="text-center text-muted">{t("auth.save_keys_warning")}</p>
        <button
          type="button"
          className="px-6 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
          onClick={() => openExportDialog(completedKeys)}
        >
          {t("profile.export_private_keys")}
        </button>
        <button
          type="button"
          className="px-6 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
          onClick={handleContinue}
        >
          {t("auth.continue")}
        </button>
      </div>
    );
  }

  // 処理中
  if (processing) {
    return (
      <div className="flex flex-col items-center gap-4">
        <Spinner />
        <p className="text-muted">{t("auth.registering")}</p>
      </div>
    );
  }

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
            {!importMode && (
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
                    disabled={isUpdateMode}
                  />
                </div>
              </>
            )}
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
            <div className="col-span-3 mt-2 flex gap-2">
              <button
                className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
                type="button"
                onClick={importKey}
              >
                {t("auth.import_key")}
              </button>
              {isAddAccountFlow && (
                <button
                  className="px-4 py-2 rounded border border-accent/30 hover:bg-accent/10 font-medium"
                  type="button"
                  onClick={auth.cancelAddAccount}
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </div>
        ) : (
          /* 生成フォーム */
          <div className="grid grid-cols-3 gap-4 items-center">
            {commonFields}
            <div className="col-span-3 mt-2 flex gap-2">
              <button
                className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
                type="button"
                onClick={generate}
              >
                {t("auth.generate")}
              </button>
              {isAddAccountFlow && (
                <button
                  className="px-4 py-2 rounded border border-accent/30 hover:bg-accent/10 font-medium"
                  type="button"
                  onClick={auth.cancelAddAccount}
                >
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default GenerateKey;
