"use client";

import { useEffect, useState, useCallback } from "react";
import { z } from "zod";
import { WorkerCallMessage, UserId } from "@/utils/schema";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { useI18n } from "@/contexts/I18nContext";
import { useDialogs } from "@/contexts/DialogContext";
import { apiClient, authApiClient, ApiError } from "@/api/client";
import { setAccountValue } from "@/utils/accountStore";
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
  // パスフレーズ確認画面用: 生成済み鍵を保持
  const [pendingKeys, setPendingKeys] = useState<string | null>(null);
  const [confirmMainPass, setConfirmMainPass] = useState("");
  const [confirmSubPass, setConfirmSubPass] = useState("");

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
      // PGP鍵のユーザIDは "user@hostname" または "Real Name <user@hostname>" 形式
      const uid = data.data.user_ids[0];
      const bracketMatch = uid.match(/<([^>]+)>/);
      const address = bracketMatch ? bracketMatch[1] : uid;
      setUserId(address);
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

  /** サーバ登録し、正規化されたユーザIDを返す。
   *  "Name <user@domain>" 形式の場合はアドレス部分のみサーバに送る。 */
  const registerAccount = useCallback(
    async (rawUserId: string, publicKeys: string): Promise<string> => {
      const bracketMatch = rawUserId.match(/<([^>]+)>/);
      const address = bracketMatch ? bracketMatch[1] : rawUserId;
      // WebAuthnのuser.nameはインポート時と一致させるため、@hostnameを含める
      const webauthnName = address.includes("@")
        ? address
        : `${address}@${window.location.host}`;

      // 新規登録: WebAuthnクレデンシャルを新規作成
      const webauthnOk = await auth.registerWebAuthn(webauthnName);
      if (!webauthnOk) {
        throw new Error("webauthn_failed");
      }

      const resp = await apiClient().user.postKeys(
        address,
        publicKeys,
        publicKeys,
      );
      return (resp.id as string) || address;
    },
    [auth],
  );

  const generate = () => {
    if (!worker || processing) return;
    const targetUserId = isUpdateMode ? auth.userId! : userId;
    if (!isUpdateMode) {
      // "Name <user@domain>" 形式からアドレス部分を抽出
      const bracketMatch = targetUserId.match(/<([^>]+)>/);
      const address = bracketMatch ? bracketMatch[1] : targetUserId;
      const localPart = address.includes("@") ? address.split("@")[0] : address;
      if (!UserId.safeParse(localPart).success) {
        showError(t("error.invalid_user_id"));
        return;
      }
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
      // 鍵生成時のPGPユーザID構築
      // "Name <user@domain>" や "user@domain" はそのまま、ベアIDには @hostname を付与
      const bracketMatch = targetUserId.match(/<([^>]+)>/);
      const address = bracketMatch ? bracketMatch[1] : targetUserId;
      const fullUserId = address.includes("@")
        ? targetUserId
        : `${targetUserId}@${window.location.host}`;

      const message: z.infer<typeof WorkerCallMessage> = {
        call: "generate",
        userId: fullUserId,
        mainPassphrase,
        subPassphrase,
      };
      worker.eventWaiter("generate", (data) => {
        if (!data.success) {
          setProcessing(false);
          return;
        }
        // パスフレーズ確認画面へ遷移
        setPendingKeys(data.data.keys);
        setMainPassphrase("");
        setSubPassphraseLocal("");
        setProcessing(false);
      });
      worker.postMessage(message);
    })();
  };

  // パスフレーズ確認後の登録処理
  const confirmPassphrases = async () => {
    if (!worker || !pendingKeys || processing) return;
    if (
      confirmMainPass.length < MIN_LENGTH ||
      confirmSubPass.length < MIN_LENGTH
    ) {
      showError(t("error.min_length"));
      return;
    }
    setProcessing(true);

    const validated = await new Promise<boolean>((resolve) => {
      worker.eventWaiter("validate_passphrases", (data) => {
        resolve(data.success);
      });
      worker.postMessage({
        call: "validate_passphrases",
        privateKeys: pendingKeys,
        mainPassphrase: confirmMainPass,
        subPassphrase: confirmSubPass,
      });
    });
    if (!validated) {
      showError(t("auth.confirm_passphrase_mismatch"));
      setProcessing(false);
      return;
    }

    const generatedKeys = pendingKeys;
    const confirmedSubPass = confirmSubPass;

    if (isUpdateMode) {
      // 鍵更新フロー
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
        auth.setSubPassphrase(confirmedSubPass);
      } else {
        auth.setSubPassphraseSession(confirmedSubPass);
      }
      setPendingKeys(null);
      setCompletedKeys(generatedKeys);
      setProcessing(false);
      return;
    }

    // 新規登録フロー: 公開鍵導出 → WebAuthn → サーバ登録 → 保存
    // activateAccountはWebAuthn成功後に呼ぶ（キャンセル時にIDBに鍵が残るのを防ぐ）
    const targetUserId = userId;

    const publicKeys = await exportPublicKeys(generatedKeys);
    if (!publicKeys) {
      showError(t("error.unknown"));
      setProcessing(false);
      return;
    }

    let canonicalId: string;
    try {
      canonicalId = await registerAccount(targetUserId, publicKeys);
    } catch (e) {
      if (e instanceof Error && e.message === "webauthn_failed") {
        showError(t("error.webauthn_failed"));
      } else if (e instanceof ApiError && e.status === 409) {
        showError(t("auth.user_exists"));
      } else if (e instanceof ApiError && e.status === 400) {
        showError(e.errorMessage || t("auth.register_error"));
      } else if (e instanceof Error && e.message === "key_mismatch") {
        showError(t("auth.key_mismatch"));
      } else {
        showError(t("auth.register_error"));
      }
      setProcessing(false);
      return;
    }

    // WebAuthn+サーバ登録成功後にローカル保存（正規IDで）
    await activateAccount(
      canonicalId,
      generatedKeys,
      saveSubPass ? confirmedSubPass : undefined,
      true, // skipReload
    );
    if (!saveSubPass) {
      auth.setSubPassphraseSession(confirmedSubPass);
    }

    // markRegistered は handleContinue で呼ぶ（ここで呼ぶと
    // isRegistered=true で layout が GenerateKey をアンマウントし、
    // エクスポート画面が表示されない）
    setPendingKeys(null);
    setCompletedKeys(generatedKeys);
    setProcessing(false);
  };

  const importKey = () => {
    if (!worker || processing) return;
    // "Name <user@domain>" 形式からアドレス部分を抽出
    const bracketMatch = userId.match(/<([^>]+)>/);
    const address = bracketMatch ? bracketMatch[1] : userId;
    const localPart = address.includes("@") ? address.split("@")[0] : address;
    if (!UserId.safeParse(localPart).success) {
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

      // WebAuthn登録（サーバ通信前に実施）
      // verifyWebAuthn + registerWebAuthn を連続呼び出しすると、
      // 最初の認証でtransient activationが失効し create() が失敗するため、
      // 登録のみ行う
      const webauthnOk = await auth.registerWebAuthn(address);
      if (!webauthnOk) {
        showError(t("error.webauthn_failed"));
        setProcessing(false);
        return;
      }

      // Worker で直接署名（activateAccount前なのでReact stateに依存しない）
      const signedMessage = await new Promise<string | null>((resolve) => {
        worker.eventWaiter("sign", (result) => {
          resolve(result.success ? result.data.signed_message : null);
        });
        worker.postMessage({
          call: "sign",
          keys: trimmedKey,
          passphrase: subPassphrase,
          payload: JSON.stringify({ nonce: new Date().toISOString() }),
        });
      });

      // 認証付きgetKeysで存在確認（アドレスで問い合わせ）
      let isExistingUser = false;
      let canonicalId: string | undefined;
      if (signedMessage) {
        try {
          const client = authApiClient(signedMessage);
          const keysResp = await client.user.getKeys(address);
          isExistingUser = true;
          canonicalId = keysResp.id as string;
        } catch (e) {
          // 404: ユーザ未登録、401: 未登録ユーザの認証失敗（正常）
          if (
            !(e instanceof ApiError && (e.status === 404 || e.status === 401))
          ) {
            showError(t("error.network"));
            setProcessing(false);
            return;
          }
        }
      }

      if (isExistingUser) {
        // 既存ユーザのキー復元: ローカル保存 → reload
        const accountId = canonicalId || address;
        await activateAccount(
          accountId,
          trimmedKey,
          saveSubPass ? subPassphrase : undefined,
          true,
        );
        if (!saveSubPass) {
          auth.setSubPassphraseSession(subPassphrase);
        }
        // activateAccount直後はmarkRegisteredのクロージャが古いuserIdを参照するため、
        // IndexedDBに直接書き込む
        await setAccountValue(accountId, "isRegistered", "true");
        window.location.reload();
        return;
      }

      // 新規ユーザ → サーバ登録（アドレスで登録）
      const publicKeys = await exportPublicKeys(trimmedKey);
      if (!publicKeys) {
        showError(t("error.unknown"));
        setProcessing(false);
        return;
      }

      try {
        const resp = await apiClient().user.postKeys(
          address,
          publicKeys,
          publicKeys,
        );
        canonicalId = resp.id as string;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          showError(t("auth.user_exists"));
        } else if (e instanceof ApiError && e.status === 400) {
          showError(e.errorMessage || t("auth.register_error"));
        } else if (e instanceof Error && e.message === "key_mismatch") {
          showError(t("auth.key_mismatch"));
        } else {
          showError(t("auth.register_error"));
        }
        setProcessing(false);
        return;
      }

      // 新規登録成功後にローカル保存（canonical IDで直接保存）
      const accountId = canonicalId || address;
      await activateAccount(
        accountId,
        trimmedKey,
        saveSubPass ? subPassphrase : undefined,
        true,
      );
      if (!saveSubPass) {
        auth.setSubPassphraseSession(subPassphrase);
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

  // パスフレーズ確認画面
  if (pendingKeys) {
    return (
      <div className="flex flex-col items-center gap-6 max-w-lg w-full mx-auto">
        <h2 className="text-lg font-semibold">
          {t("auth.confirm_passphrase")}
        </h2>
        <p className="text-center text-muted">
          {t("auth.confirm_passphrase_desc")}
        </p>
        <div className="grid grid-cols-3 gap-4 items-center w-full">
          <div className="col-span-3 sm:col-span-1">
            {t("auth.main_passphrase")}:
          </div>
          <div className="col-span-3 sm:col-span-2">
            <input
              className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
              type="password"
              value={confirmMainPass}
              onChange={(e) => setConfirmMainPass(e.target.value)}
            />
          </div>
          <div className="col-span-3 sm:col-span-1">
            {t("auth.sub_passphrase")}:
          </div>
          <div className="col-span-3 sm:col-span-2">
            <input
              className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
              type="password"
              value={confirmSubPass}
              onChange={(e) => setConfirmSubPass(e.target.value)}
            />
          </div>
          <div className="col-span-3 mt-2 flex gap-2">
            <button
              className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 font-medium"
              type="button"
              onClick={confirmPassphrases}
              disabled={processing}
            >
              {t("auth.confirm")}
            </button>
            <button
              className="px-4 py-2 rounded border border-accent/30 hover:bg-accent/10 font-medium"
              type="button"
              onClick={() => {
                setPendingKeys(null);
                setConfirmMainPass("");
                setConfirmSubPass("");
              }}
            >
              {t("common.back")}
            </button>
          </div>
        </div>
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
      {!isUpdateMode && (
        <p className="mb-4 text-center">{t("auth.init_message")}</p>
      )}
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
