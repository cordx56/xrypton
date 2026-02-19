"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { apiClient, authApiClient, ApiError } from "@/api/client";
import { ContactQuery, displayUserId } from "@/utils/schema";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressBook } from "@fortawesome/free-regular-svg-icons";
import { faPlus, faQrcode, faTrash } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import { setCachedContactIds } from "@/utils/accountStore";
import { useResolvedProfiles } from "@/hooks/useResolvedProfiles";
import type { Contact } from "@/types/contact";
import { bytesToBase64, decodeBase64Url, fromBase64Url } from "@/utils/base64";
import { canonicalize } from "@/utils/canonicalize";
import Code from "@/components/Code";
import QrReader from "@/components/QrReader";

type WotQrPayload = {
  v: number;
  type: "xrypton-wot";
  fingerprint: string;
  key_server: string;
  nonce: {
    random: string;
    time: string;
  };
};

type WotSignRequest = {
  keyServerBase: string;
  targetFingerprint: string;
  targetUserId: string;
  targetPublicKey: string;
  qrNonce: WotQrPayload["nonce"];
};

function normalizeKeyServerBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("invalid key_server protocol");
  }
  if (
    url.protocol === "http:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "::1"
  ) {
    throw new Error("insecure key_server is not allowed");
  }
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  return base.length > 0 ? base : url.origin;
}

const ContactsView = () => {
  const router = useRouter();
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [fetching, setFetching] = useState(true);
  const [scanResult, setScanResult] = useState("");
  const [scanProcessing, setScanProcessing] = useState(false);
  const { profiles, loading: resolvingProfiles } =
    useResolvedProfiles(contactIds);
  const hasWorker = !!auth.worker;

  // 連絡先 ID 一覧を取得
  const loadContactIds = useCallback(async () => {
    const signed = await auth.getSignedMessage();
    if (!signed) {
      setFetching(false);
      return;
    }

    try {
      setFetching(true);
      const client = authApiClient(signed.signedMessage);
      const rawContacts: Contact[] = await client.contacts.list();
      const ids = rawContacts.map((c) => c.contact_user_id);
      setContactIds(ids);
      // Service Worker通知フィルタ用にキャッシュ
      if (auth.userId) {
        setCachedContactIds(auth.userId, ids);
      }
    } catch {
      showError(t("error.unknown"));
    } finally {
      setFetching(false);
    }
  }, [auth.getSignedMessage, auth.userId, showError, t]);

  // Worker初期化完了後にも再実行されるようpublicKeysを依存に含める
  useEffect(() => {
    loadContactIds();
  }, [auth.userId, auth.publicKeys]);

  const handleDelete = async (contactUserId: string) => {
    if (!window.confirm(t("contacts.delete_confirm"))) return;
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const client = authApiClient(signed.signedMessage);
      await client.contacts.delete(contactUserId);
      await loadContactIds();
    } catch {
      showError(t("error.unknown"));
    }
  };

  const handleAdd = () => {
    pushDialog((p) => (
      <Dialog {...p} title={t("contacts.add_title")}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const userId = fd.get("user_id") as string;
            if (!userId) return;
            if (!ContactQuery.safeParse(userId).success) {
              showError(t("error.invalid_contact_query"));
              return;
            }

            const signed = await auth.getSignedMessage();
            if (!signed) return;
            try {
              const client = authApiClient(signed.signedMessage);
              await client.contacts.add(userId);
              p.close();
              await loadContactIds();
            } catch (e) {
              if (e instanceof ApiError) {
                if (e.status === 404) showError(t("error.contact_not_found"));
                else if (e.status === 409)
                  showError(t("error.contact_already_exists"));
                else if (e.status === 400)
                  showError(t("error.cannot_add_self"));
                else showError(t("error.unknown"));
              } else {
                showError(t("error.network"));
              }
            }
          }}
        >
          <input
            name="user_id"
            placeholder={t("contacts.user_id")}
            className="w-full border border-accent/30 rounded px-3 py-2 mb-3 bg-transparent"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-accent/30 rounded hover:bg-accent/50"
          >
            {t("common.ok")}
          </button>
        </form>
      </Dialog>
    ));
  };

  const submitWotSignature = useCallback(
    async (request: WotSignRequest) => {
      if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) {
        showError(t("error.unauthorized"));
        return;
      }
      setScanProcessing(true);
      try {
        const signaturePacketB64 = await new Promise<string | null>(
          (resolve) => {
            auth.worker!.eventWaiter("certify_key_bytes", (result) => {
              if (result.success) resolve(result.data.data);
              else resolve(null);
            });
            auth.worker!.postMessage({
              call: "certify_key_bytes",
              privateKey: auth.privateKeys!,
              targetPublicKey: request.targetPublicKey,
              passphrase: auth.subPassphrase!,
            });
          },
        );
        if (!signaturePacketB64) throw new Error("certification sign failed");

        const signed = await auth.getSignedMessage();
        if (!signed) throw new Error("authorization failed");
        await authApiClient(
          signed.signedMessage,
        ).wot.postSignatureByFingerprint(
          request.targetFingerprint,
          {
            signature_b64: signaturePacketB64,
            signature_type: "certification",
            hash_algo: "sha256",
            qr_nonce: request.qrNonce,
          },
          request.keyServerBase,
        );
        router.push(`/profile/${encodeURIComponent(request.targetUserId)}`);
      } catch (e) {
        showError(e instanceof Error ? e.message : t("error.unknown"));
      } finally {
        setScanProcessing(false);
      }
    },
    [auth, router, showError, t],
  );

  const openWotSignatureConfirmDialog = useCallback(
    (request: WotSignRequest) => {
      const suffix = `${request.targetFingerprint.slice(-8, -4)} ${request.targetFingerprint.slice(-4)}`;
      pushDialog((p) => (
        <Dialog {...p} title={t("wot.confirm_sign_title")}>
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {t("wot.confirm_sign_message")}
            </p>
            <div>
              <p className="text-xs text-muted">
                {t("wot.confirm_sign_server")}
              </p>
              <Code code={request.keyServerBase} />
            </div>
            <div>
              <p className="text-xs text-muted">
                {t("wot.confirm_sign_target")}
              </p>
              <p className="text-sm select-all">{request.targetUserId}</p>
            </div>
            <div>
              <p className="text-xs text-muted">
                {t("wot.confirm_sign_fingerprint_suffix")}
              </p>
              <p className="text-sm font-mono">{suffix}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={p.close}
                className="px-3 py-1.5 rounded border border-accent/30 text-sm hover:bg-accent/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  p.close();
                  void submitWotSignature(request);
                }}
                className="px-3 py-1.5 rounded bg-accent/20 text-sm hover:bg-accent/30"
              >
                {t("common.ok")}
              </button>
            </div>
          </div>
        </Dialog>
      ));
    },
    [pushDialog, submitWotSignature, t],
  );

  useEffect(() => {
    if (!scanResult || !auth.worker) return;
    let cancelled = false;
    setScanProcessing(true);

    (async () => {
      try {
        const split = scanResult.split(".");
        if (split.length !== 2) throw new Error("invalid qr payload");
        const [sigB64u, payloadB64u] = split;
        const payloadText = decodeBase64Url(payloadB64u);
        const payload = JSON.parse(payloadText) as WotQrPayload;
        if (payload.type !== "xrypton-wot" || payload.v !== 1) {
          throw new Error("invalid qr version/type");
        }
        if (typeof payload.key_server !== "string" || !payload.key_server) {
          throw new Error("invalid key_server");
        }
        const keyServerBase = normalizeKeyServerBaseUrl(payload.key_server);
        const fp = payload.fingerprint;
        if (!/^[A-F0-9]{40,128}$/.test(fp) || fp.length % 2 !== 0) {
          throw new Error("invalid fingerprint");
        }
        const nonceTime = new Date(payload.nonce.time).getTime();
        if (!Number.isFinite(nonceTime)) throw new Error("invalid nonce time");
        if (Math.abs(Date.now() - nonceTime) > 5 * 60 * 1000) {
          throw new Error("qr expired");
        }

        const keyResp = await apiClient().wot.getKeyByFingerprint(
          fp,
          keyServerBase,
        );
        const targetPrimaryFingerprint = keyResp.fingerprint;
        if (
          !/^[A-F0-9]{40,128}$/.test(targetPrimaryFingerprint) ||
          targetPrimaryFingerprint.length % 2 !== 0
        ) {
          throw new Error("invalid response fingerprint");
        }
        if (targetPrimaryFingerprint !== fp) {
          throw new Error("fingerprint mismatch");
        }

        const payloadBytes = new TextEncoder().encode(canonicalize(payload));
        const signatureArmored = new TextDecoder().decode(
          fromBase64Url(sigB64u),
        );
        const verifyOk = await new Promise<boolean>((resolve) => {
          auth.worker!.eventWaiter("verify_detached_signature", (result) => {
            resolve(result.success);
          });
          auth.worker!.postMessage({
            call: "verify_detached_signature",
            publicKey: keyResp.armored_public_key,
            signature: signatureArmored,
            data: bytesToBase64(payloadBytes),
          });
        });
        if (!verifyOk) throw new Error("qr signature verify failed");

        if (!cancelled) {
          openWotSignatureConfirmDialog({
            keyServerBase,
            targetFingerprint: targetPrimaryFingerprint,
            targetUserId: keyResp.user_id,
            targetPublicKey: keyResp.armored_public_key,
            qrNonce: payload.nonce,
          });
        }
      } catch (e) {
        if (!cancelled) {
          showError(e instanceof Error ? e.message : t("error.unknown"));
        }
      } finally {
        if (!cancelled) {
          setScanProcessing(false);
          setScanResult("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, openWotSignatureConfirmDialog, scanResult, showError, t]);

  const openWotScanner = useCallback(() => {
    if (!hasWorker) {
      showError(t("error.unauthorized"));
      return;
    }
    setScanResult("");
    pushDialog((p) => (
      <Dialog {...p} title="Scan Web of Trust QR">
        <div className="space-y-3">
          <QrReader
            setData={(data) => {
              setScanResult(data);
              p.close();
            }}
          />
        </div>
      </Dialog>
    ));
  }, [hasWorker, pushDialog, showError, t]);

  const loading = fetching || resolvingProfiles;

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between p-4 border-b border-accent/30">
        <h2 className="text-lg font-semibold">
          <FontAwesomeIcon icon={faAddressBook} className="mr-2" />
          {t("tab.contacts")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openWotScanner}
            disabled={scanProcessing || !hasWorker}
            className="text-sm px-3 py-1 rounded bg-accent/20 hover:bg-accent/30 disabled:opacity-50"
            title={t("wot.scan_sign")}
          >
            <FontAwesomeIcon icon={faQrcode} />
          </button>
          <button
            type="button"
            onClick={handleAdd}
            className="text-sm px-3 py-1 rounded bg-accent/20 hover:bg-accent/30"
          >
            <FontAwesomeIcon icon={faPlus} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-center text-muted p-8">{t("common.loading")}</p>
        ) : profiles.length === 0 ? (
          <p className="text-center text-muted p-8">
            {t("contacts.no_contacts")}
          </p>
        ) : (
          profiles.map((c) => {
            const displayId = displayUserId(c.userId);
            return (
              <div
                key={c.userId}
                className="flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors"
              >
                <Link
                  href={`/profile/${c.userId}`}
                  className="flex items-center gap-3 min-w-0 flex-1"
                >
                  <Avatar
                    name={c.displayName}
                    iconUrl={c.iconUrl}
                    iconSignature={c.iconSignature}
                    publicKey={c.signingPublicKey}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.displayName}</div>
                    <div className="text-xs text-muted truncate">
                      {displayId}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(c.userId)}
                  className="text-muted hover:text-fg px-2 py-1 rounded hover:bg-accent/20 flex-shrink-0"
                  title={t("common.delete")}
                >
                  <FontAwesomeIcon icon={faTrash} className="text-sm" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default ContactsView;
