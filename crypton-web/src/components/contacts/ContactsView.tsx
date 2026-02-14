"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import {
  authApiClient,
  apiClient,
  getApiBaseUrl,
  ApiError,
} from "@/api/client";
import { ContactQuery } from "@/utils/schema";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAddressBook } from "@fortawesome/free-regular-svg-icons";
import { faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import type { Contact } from "@/types/contact";

type ContactWithProfile = Contact & {
  display_name: string;
  icon_url: string | null;
};

const ContactsView = () => {
  const auth = useAuth();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [contacts, setContacts] = useState<ContactWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  // 連絡先一覧を取得し、各contactのdisplay_nameを解決
  const loadContacts = async () => {
    const signed = await auth.getSignedMessage();
    if (!signed) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const client = authApiClient(signed.signedMessage);
      const rawContacts: Contact[] = await client.contacts.list();

      const resolved = await Promise.all(
        rawContacts.map(async (c) => {
          try {
            const profile = await apiClient().user.getProfile(
              c.contact_user_id,
            );
            const iconUrl = profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}`
              : null;
            return {
              ...c,
              display_name: profile.display_name || c.contact_user_id,
              icon_url: iconUrl,
            };
          } catch {
            return { ...c, display_name: c.contact_user_id, icon_url: null };
          }
        }),
      );
      setContacts(resolved);
    } catch {
      showError(t("error.unknown"));
    } finally {
      setLoading(false);
    }
  };

  // Worker初期化完了後にも再実行されるようpublicKeysを依存に含める
  useEffect(() => {
    loadContacts();
  }, [auth.userId, auth.publicKeys]);

  const handleDelete = async (contactUserId: string) => {
    if (!window.confirm(t("contacts.delete_confirm"))) return;
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const client = authApiClient(signed.signedMessage);
      await client.contacts.delete(contactUserId);
      await loadContacts();
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
              await loadContacts();
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
        ) : contacts.length === 0 ? (
          <p className="text-center text-muted p-8">
            {t("contacts.no_contacts")}
          </p>
        ) : (
          contacts.map((c) => {
            // 同一ドメインのユーザは@domain部分を省略して表示
            const hostname = window.location.host;
            const displayId = c.contact_user_id.endsWith(`@${hostname}`)
              ? c.contact_user_id.replace(`@${hostname}`, "")
              : c.contact_user_id;
            return (
              <div
                key={c.contact_user_id}
                className="flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors"
              >
                <Link
                  href={`/contact/${c.contact_user_id}`}
                  className="flex items-center gap-3 min-w-0 flex-1"
                >
                  <Avatar name={c.display_name} iconUrl={c.icon_url} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{c.display_name}</div>
                    <div className="text-xs text-muted truncate">
                      {displayId}
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(c.contact_user_id)}
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
