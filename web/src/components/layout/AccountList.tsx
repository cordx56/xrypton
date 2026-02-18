"use client";

import { useEffect, useState, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faPlus,
  faArrowRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import {
  getCachedProfile,
  setActiveAccountId,
  syncSettingsToLocalStorage,
  deleteAccountData,
  getAccountIds,
} from "@/utils/accountStore";
import { displayUserId } from "@/utils/schema";
import { useI18n } from "@/contexts/I18nContext";
import type { AccountInfo } from "@/types/user";

type Props = {
  accountIds: string[];
  /** 現在アクティブなアカウントID（チェックマーク表示用） */
  activeId?: string;
  /** 「アカウントを追加」ボタンを表示するか */
  showAdd?: boolean;
};

/** 連絡先リストと同じスタイルのアカウント一覧。クリックでアカウント切り替え。 */
const AccountList = ({ accountIds, activeId, showAdd = false }: Props) => {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<AccountInfo[]>([]);

  useEffect(() => {
    (async () => {
      const list: AccountInfo[] = [];
      for (const id of accountIds) {
        const cached = await getCachedProfile(id);
        list.push(cached ?? { userId: id });
      }
      setProfiles(list);
    })();
  }, [accountIds]);

  const handleClick = useCallback(
    async (userId: string) => {
      if (userId === activeId) return;
      await syncSettingsToLocalStorage(userId);
      await setActiveAccountId(userId);
      window.location.reload();
    },
    [activeId],
  );

  const handleLogout = useCallback(
    async (e: React.MouseEvent, userId: string) => {
      e.stopPropagation();
      if (!window.confirm(t("account.logout_confirm"))) return;

      await deleteAccountData(userId);

      // ログアウトしたのがアクティブアカウントなら別のアカウントに切り替え
      if (userId === activeId) {
        const remaining = await getAccountIds();
        if (remaining.length > 0) {
          await syncSettingsToLocalStorage(remaining[0]);
          await setActiveAccountId(remaining[0]);
        } else {
          await setActiveAccountId(undefined);
        }
      }

      window.location.reload();
    },
    [activeId, t],
  );

  const handleAdd = useCallback(async () => {
    await setActiveAccountId(undefined);
    window.location.reload();
  }, []);

  if (profiles.length === 0) return null;

  return (
    <div className="w-full max-w-lg">
      {profiles.map((p) => {
        const isActive = p.userId === activeId;
        return (
          <button
            key={p.userId}
            type="button"
            onClick={() => handleClick(p.userId)}
            className="w-full flex items-center gap-3 px-4 py-3 border-b border-accent/10 hover:bg-accent/5 transition-colors text-left"
          >
            <Avatar
              name={p.displayName || p.userId}
              iconUrl={p.iconUrl}
              userId={p.userId}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">
                {p.displayName || displayUserId(p.userId)}
              </div>
              <div className="text-xs text-muted truncate">
                {displayUserId(p.userId)}
              </div>
            </div>
            {isActive && (
              <FontAwesomeIcon
                icon={faCheck}
                className="text-accent text-sm shrink-0"
              />
            )}
            <span
              role="button"
              tabIndex={0}
              title={t("account.logout")}
              onClick={(e) => handleLogout(e, p.userId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleLogout(e as unknown as React.MouseEvent, p.userId);
                }
              }}
              className="text-muted hover:text-red-400 transition-colors p-1 shrink-0"
            >
              <FontAwesomeIcon
                icon={faArrowRightFromBracket}
                className="text-sm"
              />
            </span>
          </button>
        );
      })}
      {showAdd && (
        <button
          type="button"
          onClick={handleAdd}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/5 transition-colors text-left text-sm"
        >
          <span className="w-10 h-10 flex items-center justify-center">
            <FontAwesomeIcon icon={faPlus} className="text-accent" />
          </span>
          {t("account.add")}
        </button>
      )}
    </div>
  );
};

export default AccountList;
