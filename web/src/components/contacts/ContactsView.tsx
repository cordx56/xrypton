"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { authApiClient, ApiError } from "@/api/client";
import { ContactQuery, displayUserId } from "@/utils/schema";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressBook } from "@fortawesome/free-regular-svg-icons";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import { setCachedContactIds } from "@/utils/accountStore";
import { useResolvedProfiles } from "@/hooks/useResolvedProfiles";
import type { Contact } from "@/types/contact";

const ContactsView = () => {
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [fetching, setFetching] = useState(true);
  const { profiles, loading: resolvingProfiles } =
    useResolvedProfiles(contactIds);

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

  const loading = fetching || resolvingProfiles;

  return (
    <div className="flex flex-col h-full max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between p-4 border-b border-accent/30">
        <h2 className="text-lg font-semibold">
          <FontAwesomeIcon icon={faAddressBook} className="mr-2" />
          {t("tab.contacts")}
        </h2>
        <button
          type="button"
          onClick={handleAdd}
          className="text-sm px-3 py-1 rounded bg-accent/20 hover:bg-accent/30"
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
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
