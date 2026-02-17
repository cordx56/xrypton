"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { useDialogs, DialogComponent } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useServiceWorker } from "@/hooks/useServiceWorker";
import { authApiClient, apiClient, getApiBaseUrl } from "@/api/client";
import { displayUserId } from "@/utils/schema";
import {
  decodeBase64Url,
  encodeToBase64,
  fromBase64Url,
  bytesToBase64,
  base64ToBytes,
} from "@/utils/base64";
import {
  isFileMessage,
  parseFileMetadata,
  buildFileMessageContent,
  isImageType,
} from "@/utils/fileMessage";
import { setCachedContactIds } from "@/utils/accountStore";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import ChatGroupList from "./ChatGroupList";
import ThreadList from "./ThreadList";
import ChatViewComponent from "./ChatView";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import { useNotification } from "@/contexts/NotificationContext";
import ChannelInfo from "./ChannelInfo";
import {
  getTempKeys,
  setTempKeys,
  getTempPubKeys,
  setTempPubKeys,
  getPendingMessages,
  setPendingMessages,
  clearPendingMessages,
} from "@/utils/tempSessionStore";
import { usePublicKeyResolver } from "@/hooks/usePublicKeyResolver";
import type { ChatGroup, Thread, Message } from "@/types/chat";
import type { Contact } from "@/types/contact";

const TEMP_SESSION_KEY_PREFIX = "TEMP_SESSION_KEY:";

type Props = {
  chatId?: string;
  threadId?: string;
};

/** メンバーの公開鍵キャッシュ: userId -> publicKeys (armored) */
type PublicKeyMap = Record<string, { name: string; publicKeys: string }>;

type ContactWithProfile = Contact & {
  display_name: string;
  icon_url: string | null;
};

/** グループ作成ダイアログ（連絡先からメンバーを選択可能） */
const NewGroupDialog: DialogComponent = ({ close, setOnClose }) => {
  const auth = useAuth();
  const chatCtx = useChat();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const { resolveDisplayName: resolveName } = usePublicKeyResolver();
  const [contacts, setContacts] = useState<ContactWithProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingContacts, setLoadingContacts] = useState(true);

  useEffect(() => {
    setOnClose(() => close());
  }, []);

  // 連絡先を取得してdisplay_nameを解決
  useEffect(() => {
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) {
        setLoadingContacts(false);
        return;
      }
      try {
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
              const name = await resolveName(
                c.contact_user_id,
                profile.display_name || c.contact_user_id,
              );
              return { ...c, display_name: name, icon_url: iconUrl };
            } catch {
              return { ...c, display_name: c.contact_user_id, icon_url: null };
            }
          }),
        );
        setContacts(resolved);
        // Service Worker通知フィルタ用にキャッシュ
        if (auth.userId) {
          setCachedContactIds(
            auth.userId,
            rawContacts.map((c: Contact) => c.contact_user_id),
          );
        }
      } catch {
        // failed to load contacts
      } finally {
        setLoadingContacts(false);
      }
    })();
  }, []);

  const toggleMember = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      <div className="flex justify-between border-b border-accent px-2 pb-2 mb-4">
        <div className="font-medium">{t("chat.new_channel")}</div>
        <button
          type="button"
          onClick={close}
          className="text-muted hover:text-fg"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
      <form
        className="px-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const name = (fd.get("name") as string) ?? "";

          const signed = await auth.getSignedMessage();
          if (!signed) return;
          try {
            await authApiClient(signed.signedMessage).chat.create(name, [
              ...selectedIds,
            ]);
            const signed2 = await auth.getSignedMessage();
            if (!signed2) return;
            const groups = await authApiClient(
              signed2.signedMessage,
            ).chat.list();
            chatCtx.setGroups(groups);
            close();
          } catch {
            showError(t("error.channel_create_failed"));
          }
        }}
      >
        <input
          name="name"
          placeholder={t("chat.channel_name")}
          className="w-full border border-accent/30 rounded px-3 py-2 mb-3 bg-transparent"
        />

        {/* メンバー選択 */}
        <div className="mb-3">
          <div className="text-sm font-medium mb-2">
            {t("contacts.select_members")}
          </div>
          {loadingContacts ? (
            <p className="text-sm text-muted">{t("common.loading")}</p>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted">{t("contacts.no_contacts")}</p>
          ) : (
            <div className="max-h-48 overflow-y-auto border border-accent/20 rounded">
              {contacts.map((c) => (
                <label
                  key={c.contact_user_id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-accent/10 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.contact_user_id)}
                    onChange={() => toggleMember(c.contact_user_id)}
                    className="accent-accent"
                  />
                  <Avatar
                    name={c.display_name}
                    iconUrl={c.icon_url}
                    size="sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{c.display_name}</div>
                    <div className="truncate text-xs text-muted">
                      {displayUserId(c.contact_user_id)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="submit"
          className="px-4 py-2 bg-accent/30 rounded hover:bg-accent/50"
        >
          {t("common.ok")}
        </button>
      </form>
    </div>
  );
};

const ChatLayout = ({ chatId, threadId }: Props) => {
  const router = useRouter();
  const pathname = usePathname();
  const isInfoRoute = !!chatId && pathname.endsWith("/info");
  const auth = useAuth();
  const chat = useChat();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { showNotification } = useNotification();
  const { showError } = useErrorToast();
  const { resolveKeys, refreshKeys, resolveDisplayName } =
    usePublicKeyResolver();
  const [loading, setLoading] = useState(false);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [selectedThreadName, setSelectedThreadName] = useState("");
  const [archivedGroups, setArchivedGroups] = useState<ChatGroup[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  // 復号セッション: スレッド切替やメッセージ全件更新時にインクリメントし、
  // 進行中の復号をキャンセルする
  const decryptVersionRef = useRef(0);
  // fetchGroupDetailの完了を待つためのPromise
  const groupDetailReady = useRef<Promise<void>>(Promise.resolve());
  // 空名グループの解決済み表示名キャッシュ（再選択時にIDが表示されるのを防ぐ）
  const resolvedGroupNamesRef = useRef<Record<string, string>>({});
  // メンバー署名公開鍵のキャッシュ（検証用、グループ選択時に取得）
  const knownPublicKeys = useRef<PublicKeyMap>({});
  // メンバー暗号化公開鍵のキャッシュ（暗号化用、グループ選択時に取得）
  const encryptionPublicKeys = useRef<string[]>([]);
  // primary_key_fingerprint → user_id の逆引きマップ
  const fingerprintToUserId = useRef<Record<string, string>>({});
  // リトライ済みメッセージの追跡（重複防止）
  const retryingMessages = useRef<Set<string>>(new Set());
  // メンバープロフィールのキャッシュ
  type MemberProfile = {
    display_name: string;
    icon_url: string | null;
    status: string;
  };
  const [memberProfiles, setMemberProfiles] = useState<
    Record<string, MemberProfile>
  >({});

  // チャンネルとスレッドの updated_at をローカルで更新する
  const touchTimestamps = (targetChatId: string, targetThreadId?: string) => {
    const now = new Date().toISOString();
    chat.setGroups(
      chat.groups.map((g) =>
        g.id === targetChatId ? { ...g, updated_at: now } : g,
      ),
    );
    if (targetThreadId) {
      chat.setThreads(
        chat.threads.map((t) =>
          t.id === targetThreadId ? { ...t, updated_at: now } : t,
        ),
      );
    }
  };

  // SWイベントハンドラ用のrefで最新値を参照
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const memberProfilesRef = useRef(memberProfiles);
  memberProfilesRef.current = memberProfiles;
  const messagesRef = useRef(chat.messages);
  messagesRef.current = chat.messages;

  // SWからのPush通知イベントをリッスンしてUI更新
  // useServiceWorkerがref経由で最新の関数を呼ぶため、useCallbackは不要
  const handleSwEvent = async (data: {
    type: string;
    chat_id?: string;
    thread_id?: string;
    name?: string;
    sender_id?: string;
    sender_name?: string;
    encrypted?: string;
    is_self?: boolean;
  }) => {
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    const client = authApiClient(signed.signedMessage);

    switch (data.type) {
      case "message": {
        // 自己メッセージの場合、送信側の楽観的追加で処理するため
        // メッセージリストの再取得をスキップ（ファイル送信時に完了前に表示されるのを防ぐ）
        if (data.is_self) break;

        // Worker経由で暗号文を復号
        let body = "New message";
        if (
          data.encrypted &&
          auth.worker &&
          auth.privateKeys &&
          auth.subPassphrase
        ) {
          try {
            body = await new Promise<string>((resolve, reject) => {
              auth.worker!.eventWaiter("decrypt", (result) => {
                if (result.success) {
                  resolve(decodeBase64Url(result.data.payload));
                } else {
                  reject(new Error(result.message));
                }
              });
              auth.worker!.postMessage({
                call: "decrypt",
                passphrase: auth.subPassphrase!,
                privateKeys: auth.privateKeys!,
                knownPublicKeys: knownPublicKeys.current,
                message: data.encrypted!,
              });
            });
          } catch {
            // 復号失敗時はデフォルトのbodyを使用
          }
        }

        // 送信者プロフィールを取得（キャッシュまたはAPI）
        const senderId = data.sender_id ?? "unknown";
        let displayName = displayUserId(senderId);
        let iconUrl: string | null = null;
        const cached = memberProfilesRef.current[senderId];
        if (cached) {
          displayName = cached.display_name;
          iconUrl = cached.icon_url;
        } else if (data.sender_name) {
          // サーバが平文解決済みの sender_name を付与している場合はそれを使う
          displayName = data.sender_name;
          try {
            const profile = await apiClient().user.getProfile(senderId);
            iconUrl = profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}`
              : null;
          } catch {
            // アイコン取得失敗は無視
          }
        } else {
          try {
            const profile = await apiClient().user.getProfile(senderId);
            displayName = await resolveDisplayName(
              senderId,
              profile.display_name || displayUserId(senderId),
            );
            iconUrl = profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}`
              : null;
          } catch {
            // プロフィール取得失敗時はsenderIdを使用
          }
        }

        showNotification({ displayName, iconUrl, body });

        // チャンネルとスレッドの更新日時を更新
        if (data.chat_id) {
          touchTimestamps(data.chat_id, data.thread_id);
        }

        // 現在閲覧中でないチャンネル/スレッドを未読にする
        if (data.chat_id) {
          const viewingThread =
            chatIdRef.current === data.chat_id &&
            threadIdRef.current === data.thread_id;
          if (!viewingThread) {
            chat.markUnread(data.chat_id, data.thread_id);
          }
        }

        // 現在表示中のチャットと一致する場合、メッセージリストを再取得
        const currentChatId = chatIdRef.current;
        const currentThreadId = threadIdRef.current;
        if (
          currentChatId &&
          currentThreadId &&
          data.chat_id &&
          currentChatId === data.chat_id
        ) {
          try {
            const signed2 = await auth.getSignedMessage();
            if (!signed2) break;
            const client2 = authApiClient(signed2.signedMessage);
            const msgData = await client2.message.list(
              currentChatId,
              currentThreadId,
            );
            const rawMessages: Message[] = msgData.messages ?? [];
            chat.setTotalMessages(msgData.total ?? 0);
            const decrypted = await mergeAndDecryptNewMessages(rawMessages);

            // temp session: 新しい鍵交換メッセージがあるか確認し、保留メッセージを送信
            const thread = chat.threads.find((t) => t.id === currentThreadId);
            if (thread?.expires_at) {
              const memberCount =
                Object.keys(memberProfilesRef.current).length || 1;
              await collectTempKeysAndFlush(
                currentChatId,
                currentThreadId,
                decrypted,
                memberCount,
              );
            }
          } catch {
            // failed to refresh messages
          }
        }
        break;
      }
      case "added_to_group": {
        try {
          const groups = await client.chat.list();
          chat.setGroups(groups);
        } catch {
          // failed to refresh groups
        }
        break;
      }
      case "new_thread": {
        const currentChatId = chatIdRef.current;
        if (currentChatId && data.chat_id && currentChatId === data.chat_id) {
          try {
            const detail = await client.chat.get(data.chat_id);
            chat.setThreads(detail.threads ?? []);
          } catch {
            // failed to refresh threads
          }
        }
        break;
      }
    }
  };

  useServiceWorker(handleSwEvent);

  // iOS SafariではSWからのpostMessageが届かない場合があるため、
  // ページが再度可視状態になった際にデータを再取得するフォールバック
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        const groups = await client.chat.list();
        chat.setGroups(groups);

        const currentChatId = chatIdRef.current;
        const currentThreadId = threadIdRef.current;
        if (currentChatId) {
          const detail = await client.chat.get(currentChatId);
          chat.setThreads(detail.threads ?? []);
        }
        if (currentChatId && currentThreadId) {
          const msgData = await client.message.list(
            currentChatId,
            currentThreadId,
          );
          const rawMessages: Message[] = msgData.messages ?? [];
          chat.setTotalMessages(msgData.total ?? 0);
          await mergeAndDecryptNewMessages(rawMessages);
        }
      } catch {
        // failed to refresh on visibility change
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [
    auth.getSignedMessage,
    auth.worker,
    auth.privateKeys,
    auth.subPassphrase,
  ]);

  // 初期化: グループ一覧を取得
  useEffect(() => {
    (async () => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        const groups = await client.chat.list();
        chat.setGroups(groups);
      } catch {
        // failed to load groups
      }
    })();
  }, [auth.userId, auth.publicKeys]);

  // グループ詳細（メンバー公開鍵・プロフィール）を取得してキャッシュに格納
  const fetchGroupDetail = useCallback(
    async (groupId: string) => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);
      const data = await client.chat.get(groupId);
      chat.setThreads(data.threads ?? []);
      setArchivedThreads(data.archived_threads ?? []);

      const pubKeys: PublicKeyMap = {};
      const encPubKeys: string[] = [];
      const fingerprintMap: Record<string, string> = {};
      const profiles: Record<string, MemberProfile> = {};
      for (const member of data.members ?? []) {
        try {
          const resolved = await resolveKeys(member.user_id);
          if (resolved) {
            pubKeys[resolved.primary_key_fingerprint] = {
              name: member.user_id,
              publicKeys: resolved.signing_public_key,
            };
            encPubKeys.push(resolved.encryption_public_key);
            fingerprintMap[resolved.primary_key_fingerprint] = member.user_id;
          }
        } catch {
          // 公開鍵を取得できないメンバーはスキップ
        }
        try {
          const profile = await apiClient().user.getProfile(member.user_id);
          const resolvedName = await resolveDisplayName(
            member.user_id,
            profile.display_name || member.user_id,
          );
          profiles[member.user_id] = {
            display_name: resolvedName,
            icon_url: profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}`
              : null,
            status: profile.status ?? "",
          };
        } catch {
          profiles[member.user_id] = {
            display_name: member.user_id,
            icon_url: null,
            status: "",
          };
        }
      }
      knownPublicKeys.current = pubKeys;
      encryptionPublicKeys.current = encPubKeys;
      fingerprintToUserId.current = fingerprintMap;
      setMemberProfiles(profiles);

      // 空名グループの場合、メンバー表示名で代替しキャッシュに保存
      if (!data.group?.name) {
        const others = Object.entries(profiles)
          .filter(([id]) => id !== auth.userId)
          .map(([, p]) => p.display_name);
        const displayName =
          others.length > 0
            ? others.join(", ")
            : (profiles[auth.userId!]?.display_name ?? groupId);
        resolvedGroupNamesRef.current[groupId] = displayName;
        setSelectedGroupName(displayName);
      }
    },
    [auth.getSignedMessage, auth.userId, chat, resolveKeys, resolveDisplayName],
  );

  // chatIdが変わった時にグループ詳細を取得
  useEffect(() => {
    if (!chatId) return;
    // グループ名を仮設定（空名の場合はfetchGroupDetailでメンバー表示名に更新される）
    const group = chat.groups.find((g) => g.id === chatId);
    if (group)
      setSelectedGroupName(
        group.name || resolvedGroupNamesRef.current[chatId] || group.id,
      );
    groupDetailReady.current = fetchGroupDetail(chatId).catch(() => {});
  }, [chatId]);

  // threadIdが変わった時にメッセージを取得
  useEffect(() => {
    if (!chatId || !threadId) return;
    const thread = chat.threads.find((t) => t.id === threadId);
    if (thread) setSelectedThreadName(thread.name || thread.id);

    chat.setMessages([]);
    chat.setTotalMessages(0);
    setLoading(true);

    (async () => {
      try {
        const signed = await auth.getSignedMessage();
        if (!signed) return;
        const client = authApiClient(signed.signedMessage);
        const data = await client.message.list(chatId, threadId);
        chat.setTotalMessages(data.total ?? 0);

        // temp session: 鍵がなければ生成して鍵交換メッセージを送信
        if (thread?.expires_at) {
          if (!getTempKeys(threadId)) {
            try {
              await generateAndSendTempKey(chatId, threadId);
            } catch {
              // 鍵生成失敗
            }
          }
        }

        // 暗号化状態のメッセージを即座に表示し、プログレッシブに復号
        const rawMessages: Message[] = data.messages ?? [];
        chat.setMessages(rawMessages.map((m) => ({ ...m, encrypted: true })));
        setLoading(false);

        // メンバー公開鍵の取得完了を待ってから復号を開始
        await groupDetailReady.current;

        const version = ++decryptVersionRef.current;
        const decrypted = await decryptMessagesProgressively(
          rawMessages,
          version,
        );

        // temp session: メッセージから鍵交換情報を収集し、保留メッセージを送信
        if (thread?.expires_at) {
          const memberCount = Object.keys(memberProfiles).length || 1;
          await collectTempKeysAndFlush(
            chatId,
            threadId,
            decrypted,
            memberCount,
          );
        }
      } catch {
        showError(t("error.message_load_failed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [chatId, threadId]);

  // アーカイブ済みグループを取得
  const fetchArchivedGroups = useCallback(async () => {
    const signed = await auth.getSignedMessage();
    if (!signed) return;
    try {
      const client = authApiClient(signed.signedMessage);
      const groups = await client.chat.listArchived();
      setArchivedGroups(groups);
    } catch {
      // failed to load archived groups
    }
  }, [auth.getSignedMessage]);

  // グループアーカイブ
  const handleArchiveGroup = useCallback(
    async (group: ChatGroup) => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        await client.chat.archive(group.id);
        chat.setGroups(chat.groups.filter((g) => g.id !== group.id));
      } catch {
        showError(t("error.archive_failed"));
      }
    },
    [auth.getSignedMessage, chat, showError, t],
  );

  // グループアーカイブ解除
  const handleUnarchiveGroup = useCallback(
    async (group: ChatGroup) => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        await authApiClient(signed.signedMessage).chat.unarchive(group.id);
        setArchivedGroups((prev) => prev.filter((g) => g.id !== group.id));
        // アクティブなグループ一覧をリフレッシュ（新しいnonceが必要）
        const signed2 = await auth.getSignedMessage();
        if (!signed2) return;
        const groups = await authApiClient(signed2.signedMessage).chat.list();
        chat.setGroups(groups);
      } catch {
        showError(t("error.archive_failed"));
      }
    },
    [auth.getSignedMessage, chat, showError, t],
  );

  // スレッドアーカイブ
  const handleArchiveThread = useCallback(
    async (thread: Thread) => {
      if (!chatId) return;
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        const client = authApiClient(signed.signedMessage);
        await client.thread.archive(chatId, thread.id);
        chat.setThreads(chat.threads.filter((t) => t.id !== thread.id));
        setArchivedThreads((prev) => [
          ...prev,
          { ...thread, archived_at: new Date().toISOString() },
        ]);
      } catch {
        showError(t("error.archive_failed"));
      }
    },
    [auth.getSignedMessage, chatId, chat, showError, t],
  );

  // スレッドアーカイブ解除
  const handleUnarchiveThread = useCallback(
    async (thread: Thread) => {
      if (!chatId) return;
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      try {
        await authApiClient(signed.signedMessage).thread.unarchive(
          chatId,
          thread.id,
        );
        setArchivedThreads((prev) => prev.filter((t) => t.id !== thread.id));
        // アクティブなスレッド一覧をリフレッシュ（新しいnonceが必要）
        const signed2 = await auth.getSignedMessage();
        if (!signed2) return;
        const detail = await authApiClient(signed2.signedMessage).chat.get(
          chatId,
        );
        chat.setThreads(detail.threads ?? []);
      } catch {
        showError(t("error.archive_failed"));
      }
    },
    [auth.getSignedMessage, chatId, chat, showError, t],
  );

  // グループ選択
  const selectGroup = useCallback(
    (group: ChatGroup) => {
      setSelectedGroupName(
        group.name || resolvedGroupNamesRef.current[group.id] || group.id,
      );
      chat.markGroupRead(group.id);
      router.push(`/chat/${group.id}`);
    },
    [router, chat.markGroupRead],
  );

  // スレッド選択
  const selectThread = useCallback(
    (thread: Thread) => {
      if (!chatId) return;
      setSelectedThreadName(thread.name || thread.id);
      chat.markThreadRead(thread.id);
      router.push(`/chat/${chatId}/${thread.id}`);
    },
    [chatId, router, chat.markThreadRead],
  );

  // 現在のスレッドがtemp sessionかどうかを判定
  const isTempSession = (tid?: string): boolean => {
    if (!tid) return false;
    const thread = chat.threads.find((t) => t.id === tid);
    return !!thread?.expires_at;
  };

  // Worker経由で1件復号するヘルパー
  const workerDecrypt = (
    content: string,
    privateKeys: string,
    passphrase: string,
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("decrypt", (result) => {
        if (result.success) {
          resolve(decodeBase64Url(result.data.payload));
        } else {
          reject(new Error(result.message));
        }
      });
      auth.worker!.postMessage({
        call: "decrypt",
        passphrase,
        privateKeys,
        knownPublicKeys: knownPublicKeys.current,
        message: content,
      });
    });

  // 1件のメッセージを復号し、結果を返す
  // isKeyExchange=true の場合は鍵交換メッセージなので表示から除外する
  const decryptOne = async (
    msg: Message,
    tempSession: boolean,
    tempKeys: { privateKey: string; passphrase: string } | null,
  ): Promise<{
    content: string;
    isKeyExchange: boolean;
    failed: boolean;
    errorMessage?: string;
  }> => {
    try {
      const decrypted = await workerDecrypt(
        msg.content,
        auth.privateKeys!,
        auth.subPassphrase!,
      );
      if (decrypted.startsWith(TEMP_SESSION_KEY_PREFIX)) {
        return { content: decrypted, isKeyExchange: true, failed: false };
      }
      // temp sessionの場合、一時鍵で再復号を試みる
      if (tempSession && tempKeys) {
        try {
          const tempDecrypted = await workerDecrypt(
            msg.content,
            tempKeys.privateKey,
            tempKeys.passphrase,
          );
          return {
            content: tempDecrypted,
            isKeyExchange: false,
            failed: false,
          };
        } catch {
          // 一時鍵での復号失敗時は通常の復号結果を使用
        }
      }
      return { content: decrypted, isKeyExchange: false, failed: false };
    } catch (e) {
      // 通常の復号にも失敗した場合、temp sessionなら一時鍵で直接試みる
      if (tempSession && tempKeys) {
        try {
          const tempDecrypted = await workerDecrypt(
            msg.content,
            tempKeys.privateKey,
            tempKeys.passphrase,
          );
          return {
            content: tempDecrypted,
            isKeyExchange: tempDecrypted.startsWith(TEMP_SESSION_KEY_PREFIX),
            failed: false,
          };
        } catch {
          // 一時鍵でも復号失敗
        }
      }
      const errorMessage = e instanceof Error ? e.message : undefined;
      return {
        content: msg.content,
        isKeyExchange: false,
        failed: true,
        errorMessage,
      };
    }
  };

  // 鍵関連エラーかどうかを判定する（リトライ対象）
  const isKeyRelatedError = (errorMessage?: string): boolean => {
    if (!errorMessage) return false;
    const retryable = [
      "unknown sender",
      "outer signature verification failed",
      "inner signature verification failed",
      "outer signer not found in inner signers",
    ];
    return retryable.some((e) => errorMessage.includes(e));
  };

  // 特定ユーザの鍵をサーバから再取得し、インメモリ ref を更新する
  const refreshUserKeysAndUpdateRefs = async (
    userId: string,
  ): Promise<{ changed: boolean }> => {
    const result = await refreshKeys(userId);
    if (result.status === "changed") {
      // インメモリ ref を更新（confirmed に関わらず復号リトライ用）
      // 古い key_id のエントリを削除
      for (const [fingerprint, uid] of Object.entries(
        fingerprintToUserId.current,
      )) {
        if (uid === userId) {
          delete knownPublicKeys.current[fingerprint];
          delete fingerprintToUserId.current[fingerprint];
        }
      }
      knownPublicKeys.current[result.keys.primary_key_fingerprint] = {
        name: userId,
        publicKeys: result.keys.signing_public_key,
      };
      fingerprintToUserId.current[result.keys.primary_key_fingerprint] = userId;
      return { changed: true };
    }
    return { changed: false };
  };

  // 復号失敗時に鍵を再取得してリトライする
  const handleKeyRefreshAndRetry = async (
    msg: Message,
    errorMessage: string | undefined,
    tempSession: boolean,
    tempKeys: { privateKey: string; passphrase: string } | null,
  ): Promise<{
    content: string;
    isKeyExchange: boolean;
    failed: boolean;
    errorMessage?: string;
  } | null> => {
    if (!isKeyRelatedError(errorMessage)) return null;
    if (retryingMessages.current.has(msg.id)) return null;
    retryingMessages.current.add(msg.id);

    try {
      // sender_id からリフレッシュ対象を特定
      const targetUserIds: string[] = [];
      if (msg.sender_id) {
        targetUserIds.push(msg.sender_id);
      } else {
        // sender_id が不明の場合は全メンバーを再取得
        targetUserIds.push(...Object.keys(memberProfilesRef.current));
      }

      for (const uid of targetUserIds) {
        await refreshUserKeysAndUpdateRefs(uid);
      }

      // 更新された鍵でリトライ
      return await decryptOne(msg, tempSession, tempKeys);
    } finally {
      retryingMessages.current.delete(msg.id);
    }
  };

  // メッセージを最新→古い順にプログレッシブに復号し、1件ごとに表示を更新する。
  // 呼び出し前に encrypted: true のメッセージを setMessages しておくこと。
  // version が変わった場合（スレッド切替等）は途中で打ち切る。
  const decryptMessagesProgressively = async (
    messages: Message[],
    version: number,
  ): Promise<Message[]> => {
    if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      return messages;
    }

    const currentThreadId = threadId;
    const tempSession = isTempSession(currentThreadId);
    const tempKeys = currentThreadId ? getTempKeys(currentThreadId) : null;

    const allDecrypted: Message[] = [];

    // 最新のメッセージから順に復号
    for (let i = messages.length - 1; i >= 0; i--) {
      if (decryptVersionRef.current !== version) return allDecrypted;

      const msg = messages[i];
      let result = await decryptOne(msg, tempSession, tempKeys);

      // 鍵関連エラーの場合、鍵を再取得してリトライ
      if (result.failed && isKeyRelatedError(result.errorMessage)) {
        const retryResult = await handleKeyRefreshAndRetry(
          msg,
          result.errorMessage,
          tempSession,
          tempKeys,
        );
        if (retryResult) result = retryResult;
      }

      if (decryptVersionRef.current !== version) return allDecrypted;

      if (result.isKeyExchange) {
        allDecrypted.push({ ...msg, content: result.content });
        chat.setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      } else {
        const fileMeta = !result.failed
          ? parseFileMetadata(result.content)
          : null;
        const updated: Message = {
          ...msg,
          content: result.content,
          encrypted: undefined,
          decryptFailed: result.failed || undefined,
          fileMetadata: fileMeta ?? undefined,
        };
        allDecrypted.push(updated);
        chat.setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? updated : m)),
        );
        // 画像ファイルの場合は自動ダウンロード
        if (fileMeta && isImageType(fileMeta.type) && msg.file_id) {
          loadImagePreview(updated);
        }
      }
    }
    return allDecrypted;
  };

  // 既存の復号済みメッセージを保持したまま、新着メッセージのみを追加・復号する。
  // 進行中の初期復号をキャンセルせず、新規メッセージだけを独立して復号する。
  const mergeAndDecryptNewMessages = async (
    rawMessages: Message[],
  ): Promise<Message[]> => {
    // React 18のバッチ更新ではsetMessages内の関数更新が遅延実行されるため、
    // 差分計算はrefから行い、setMessagesの副作用に依存しない
    const existingIds = new Set(messagesRef.current.map((m) => m.id));
    const newRawMessages = rawMessages.filter((m) => !existingIds.has(m.id));
    if (newRawMessages.length === 0) return [];
    chat.setMessages((prev) => {
      const prevIds = new Set(prev.map((m) => m.id));
      const toAdd = newRawMessages.filter((m) => !prevIds.has(m.id));
      if (toAdd.length === 0) return prev;
      return [...prev, ...toAdd.map((m) => ({ ...m, encrypted: true }))];
    });
    if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) return [];

    const currentThreadId = threadIdRef.current;
    const tempSession = isTempSession(currentThreadId);
    const tempKeys = currentThreadId ? getTempKeys(currentThreadId) : null;
    const allDecrypted: Message[] = [];

    for (const msg of newRawMessages) {
      try {
        let result = await decryptOne(msg, tempSession, tempKeys);

        // 鍵関連エラーの場合、鍵を再取得してリトライ
        if (result.failed && isKeyRelatedError(result.errorMessage)) {
          const retryResult = await handleKeyRefreshAndRetry(
            msg,
            result.errorMessage,
            tempSession,
            tempKeys,
          );
          if (retryResult) result = retryResult;
        }

        if (result.isKeyExchange) {
          allDecrypted.push({ ...msg, content: result.content });
          chat.setMessages((prev) => prev.filter((m) => m.id !== msg.id));
        } else {
          const fileMeta = !result.failed
            ? parseFileMetadata(result.content)
            : null;
          const updated: Message = {
            ...msg,
            content: result.content,
            encrypted: undefined,
            decryptFailed: result.failed || undefined,
            fileMetadata: fileMeta ?? undefined,
          };
          allDecrypted.push(updated);
          chat.setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? updated : m)),
          );
          // 画像ファイルの場合は自動ダウンロード
          if (fileMeta && isImageType(fileMeta.type) && msg.file_id) {
            loadImagePreview(updated);
          }
        }
      } catch {
        chat.setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id
              ? { ...msg, encrypted: undefined, decryptFailed: true }
              : m,
          ),
        );
      }
    }
    return allDecrypted;
  };

  const handleNewGroup = () => {
    pushDialog(NewGroupDialog);
  };

  // temp session用: PGP鍵を生成して鍵交換メッセージを送信
  const generateAndSendTempKey = async (
    targetChatId: string,
    targetThreadId: string,
  ) => {
    if (!auth.worker) return;
    const signed = await auth.getSignedMessage();
    if (!signed) return;

    const passphrase = crypto.randomUUID();
    const userId = signed.userId;

    // Worker経由でPGP鍵を生成
    const keys = await new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("generate", (result) => {
        if (result.success) resolve(result.data.keys);
        else reject(new Error(result.message));
      });
      auth.worker!.postMessage({
        call: "generate",
        userId,
        mainPassphrase: passphrase,
        subPassphrase: passphrase,
      });
    });

    // 公開鍵をエクスポート
    const publicKey = await new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("export_public_keys", (result) => {
        if (result.success) resolve(result.data.keys);
        else reject(new Error(result.message));
      });
      auth.worker!.postMessage({
        call: "export_public_keys",
        keys,
      });
    });

    // sessionStorageに保存
    setTempKeys(targetThreadId, { privateKey: keys, passphrase });

    // 鍵交換メッセージを送信（通常の暗号化で）
    const client = authApiClient(signed.signedMessage);
    const keyMsg = `${TEMP_SESSION_KEY_PREFIX}${publicKey}`;

    if (
      auth.privateKeys &&
      auth.subPassphrase &&
      encryptionPublicKeys.current.length > 0
    ) {
      const plainBase64 = encodeToBase64(keyMsg);
      const encrypted = await new Promise<string>((resolve, reject) => {
        auth.worker!.eventWaiter("encrypt", (result) => {
          if (result.success) resolve(result.data.message);
          else reject(new Error(result.message));
        });
        auth.worker!.postMessage({
          call: "encrypt",
          passphrase: auth.subPassphrase!,
          privateKeys: auth.privateKeys!,
          publicKeys: encryptionPublicKeys.current,
          payload: plainBase64,
        });
      });
      await client.message.send(targetChatId, targetThreadId, encrypted);
    }
  };

  // temp sessionメッセージから鍵交換メッセージを収集し、保留メッセージを送信
  const collectTempKeysAndFlush = async (
    targetChatId: string,
    targetThreadId: string,
    messages: Message[],
    memberCount: number,
  ) => {
    const pubKeys: Record<string, string> =
      getTempPubKeys(targetThreadId) ?? {};

    // TEMP_SESSION_KEY:プレフィックスのメッセージから公開鍵を収集
    for (const msg of messages) {
      if (msg.content.startsWith(TEMP_SESSION_KEY_PREFIX) && msg.sender_id) {
        pubKeys[msg.sender_id] = msg.content.slice(
          TEMP_SESSION_KEY_PREFIX.length,
        );
      }
    }

    setTempPubKeys(targetThreadId, pubKeys);

    // 全メンバーの公開鍵が揃った場合、保留メッセージを送信
    if (Object.keys(pubKeys).length >= memberCount) {
      const pending = getPendingMessages(targetThreadId);
      if (pending.length > 0 && auth.worker) {
        const tempKeys = getTempKeys(targetThreadId);
        if (!tempKeys) return;

        const signed = await auth.getSignedMessage();
        if (!signed) return;
        const client = authApiClient(signed.signedMessage);
        const allPubKeys = Object.values(pubKeys);

        for (const text of pending) {
          try {
            const plainBase64 = encodeToBase64(text);
            const encrypted = await new Promise<string>((resolve, reject) => {
              auth.worker!.eventWaiter("encrypt", (result) => {
                if (result.success) resolve(result.data.message);
                else reject(new Error(result.message));
              });
              auth.worker!.postMessage({
                call: "encrypt",
                passphrase: auth.subPassphrase!,
                privateKeys: auth.privateKeys!,
                publicKeys: allPubKeys,
                payload: plainBase64,
              });
            });
            await client.message.send(targetChatId, targetThreadId, encrypted);
          } catch {
            // 送信失敗した保留メッセージはスキップ
          }
        }
        clearPendingMessages(targetThreadId);
      }
    }
  };

  const handleNewThread = () => {
    pushDialog((p) => {
      const [isTempSession, setIsTempSession] = useState(false);
      const [threadName, setThreadName] = useState("");
      return (
        <Dialog {...p} title={t("chat.new_thread")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const name = fd.get("name") as string;
              if (!name || !chatId) return;

              const expiresAt = isTempSession
                ? (fd.get("expires_at") as string)
                : undefined;
              // temp sessionの場合、終了時刻が必須
              if (isTempSession && !expiresAt) return;

              // ISO 8601形式に変換（datetime-localはローカル時刻）
              const expiresAtIso = expiresAt
                ? new Date(expiresAt).toISOString()
                : undefined;

              const signed = await auth.getSignedMessage();
              if (!signed) return;
              try {
                const client = authApiClient(signed.signedMessage);
                const result = await client.chat.createThread(
                  chatId,
                  name,
                  expiresAtIso,
                );
                const newThread: Thread = {
                  id: result.id,
                  chat_id: result.chat_id ?? chatId,
                  name,
                  created_by: signed.userId,
                  created_at: new Date().toISOString(),
                  expires_at: expiresAtIso,
                };
                chat.setThreads([...chat.threads, newThread]);

                // temp sessionの場合、PGP鍵を生成して鍵交換メッセージを送信
                if (isTempSession) {
                  try {
                    await generateAndSendTempKey(chatId, result.id);
                  } catch {
                    // 鍵生成失敗はスレッド作成自体は成功しているので無視しない
                  }
                }

                p.close();
              } catch {
                showError(t("error.unknown"));
              }
            }}
          >
            <input
              name="name"
              placeholder={t("chat.thread_name")}
              className="w-full border border-accent/30 rounded px-3 py-2 mb-3 bg-transparent"
              onChange={(e) => setThreadName(e.target.value)}
            />
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isTempSession}
                onChange={(e) => setIsTempSession(e.target.checked)}
                className="accent-accent"
              />
              <span className="text-sm">{t("chat.temporary_session")}</span>
            </label>
            {isTempSession && (
              <div className="mb-3">
                <label className="block text-sm text-muted mb-1">
                  {t("chat.expires_at")}
                </label>
                <input
                  name="expires_at"
                  type="datetime-local"
                  className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={!threadName.trim()}
              className="px-4 py-2 bg-accent/30 rounded hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("common.ok")}
            </button>
          </form>
        </Dialog>
      );
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!chatId || !threadId) return;

    const signed = await auth.getSignedMessage();
    if (!signed || !auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      return;
    }

    // temp sessionの場合の分岐
    if (isTempSession(threadId)) {
      const tempKeys = getTempKeys(threadId);
      if (!tempKeys) return;

      const pubKeys = getTempPubKeys(threadId);
      const memberCount = Object.keys(memberProfiles).length || 1;

      // 全メンバーの公開鍵が揃っていない場合は保留
      if (!pubKeys || Object.keys(pubKeys).length < memberCount) {
        const pending = getPendingMessages(threadId);
        setPendingMessages(threadId, [...pending, text]);
        // 保留中であることをローカルに表示
        chat.setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            thread_id: threadId,
            sender_id: signed.userId,
            content: `[${t("chat.pending_messages")}] ${text}`,
            created_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      // main keys で署名+暗号化して送信（外側署名はサーバが検証する）
      try {
        const plainBase64 = encodeToBase64(text);
        const allPubKeys = Object.values(pubKeys);
        const encrypted = await new Promise<string>((resolve, reject) => {
          auth.worker!.eventWaiter("encrypt", (result) => {
            if (result.success) resolve(result.data.message);
            else reject(new Error(result.message));
          });
          auth.worker!.postMessage({
            call: "encrypt",
            passphrase: auth.subPassphrase!,
            privateKeys: auth.privateKeys!,
            publicKeys: allPubKeys,
            payload: plainBase64,
          });
        });

        const client = authApiClient(signed.signedMessage);
        const result = await client.message.send(chatId, threadId, encrypted);
        chat.setMessages((prev) => [
          ...prev,
          {
            id: result.id ?? crypto.randomUUID(),
            thread_id: threadId,
            sender_id: signed.userId,
            content: text,
            created_at: new Date().toISOString(),
          },
        ]);
        touchTimestamps(chatId, threadId);
      } catch {
        showError(t("error.message_send_failed"));
      }
      return;
    }

    // 通常のメッセージ送信
    if (encryptionPublicKeys.current.length === 0) {
      return;
    }

    try {
      const plainBase64 = encodeToBase64(text);

      const encrypted = await new Promise<string>((resolve, reject) => {
        auth.worker!.eventWaiter("encrypt", (result) => {
          if (result.success) {
            resolve(result.data.message);
          } else {
            reject(new Error(result.message));
          }
        });
        auth.worker!.postMessage({
          call: "encrypt",
          passphrase: auth.subPassphrase!,
          privateKeys: auth.privateKeys!,
          publicKeys: encryptionPublicKeys.current,
          payload: plainBase64,
        });
      });

      const client = authApiClient(signed.signedMessage);
      const result = await client.message.send(chatId, threadId, encrypted);

      chat.setMessages((prev) => [
        ...prev,
        {
          id: result.id ?? crypto.randomUUID(),
          thread_id: threadId,
          sender_id: signed.userId,
          content: text,
          created_at: new Date().toISOString(),
        },
      ]);
      touchTimestamps(chatId, threadId);
    } catch {
      showError(t("error.message_send_failed"));
    }
  };

  // Worker経由で暗号化するヘルパー（armored出力）
  const workerEncrypt = (
    payload: string,
    publicKeys: string[],
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("encrypt", (result) => {
        if (result.success) resolve(result.data.message);
        else reject(new Error(result.message));
      });
      auth.worker!.postMessage({
        call: "encrypt",
        passphrase: auth.subPassphrase!,
        privateKeys: auth.privateKeys!,
        publicKeys,
        payload,
      });
    });

  // Worker経由でバイナリ暗号化するヘルパー（raw PGP bytes → base64で返却）
  const workerEncryptBin = (
    payload: string,
    publicKeys: string[],
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("encrypt_bin", (result) => {
        if (result.success) resolve(result.data.data);
        else reject(new Error(result.message));
      });
      auth.worker!.postMessage({
        call: "encrypt_bin",
        passphrase: auth.subPassphrase!,
        privateKeys: auth.privateKeys!,
        publicKeys,
        payload,
      });
    });

  // Worker経由でバイナリ復号するヘルパー（完全な Signed(Encrypted(Signed(Data))) を復号）
  const workerDecryptBin = (
    data: string,
    privateKeys: string,
    passphrase: string,
  ): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      auth.worker!.eventWaiter("decrypt_bin", (result) => {
        if (result.success) {
          resolve(result.data.payload);
        } else {
          reject(new Error(result.message));
        }
      });
      auth.worker!.postMessage({
        call: "decrypt_bin",
        passphrase,
        privateKeys,
        knownPublicKeys: knownPublicKeys.current,
        data,
      });
    });

  const handleSendFile = async (file: File) => {
    if (!chatId || !threadId) return;

    // ファイルサイズ制限: 10MB
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      showError(t("error.file_too_large"));
      return;
    }

    const signed = await auth.getSignedMessage();
    if (!signed || !auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      return;
    }
    if (encryptionPublicKeys.current.length === 0) return;

    try {
      // メタデータを暗号化（armored: サーバが外側署名を検証する）
      const metaContent = buildFileMessageContent({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      });
      const metaBase64 = encodeToBase64(metaContent);
      const encryptedMeta = await workerEncrypt(
        metaBase64,
        encryptionPublicKeys.current,
      );

      // ファイルバイトをバイナリのまま暗号化（raw PGP bytes）
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const fileBase64 = bytesToBase64(fileBytes);
      const encryptedBase64 = await workerEncryptBin(
        fileBase64,
        encryptionPublicKeys.current,
      );

      // base64 → バイナリに戻してアップロード
      const encryptedBytes = base64ToBytes(encryptedBase64);

      // multipartでアップロード
      const client = authApiClient(signed.signedMessage);
      const fileBlob = new Blob([encryptedBytes.buffer as ArrayBuffer], {
        type: "application/octet-stream",
      });
      const result = await client.file.upload(
        chatId,
        threadId,
        encryptedMeta,
        fileBlob,
      );

      // ローカルメッセージリストに楽観的追加
      const fileMetadata = {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
      };
      const fileBlobUrl = isImageType(fileMetadata.type)
        ? URL.createObjectURL(file)
        : undefined;
      chat.setMessages((prev) => [
        ...prev,
        {
          id: result.id ?? crypto.randomUUID(),
          thread_id: threadId,
          sender_id: signed.userId,
          content: metaContent,
          file_id: result.file_id,
          created_at: new Date().toISOString(),
          fileMetadata,
          fileBlobUrl,
        },
      ]);
      touchTimestamps(chatId, threadId);
    } catch {
      showError(t("error.file_upload_failed"));
    }
  };

  // ファイルをダウンロード・復号して Blob を返す共通ヘルパー
  const decryptFileToBlob = async (message: Message): Promise<Blob | null> => {
    if (!message.file_id || !message.fileMetadata) return null;
    if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) return null;

    const signed = await auth.getSignedMessage();
    if (!signed) return null;

    const client = authApiClient(signed.signedMessage);
    const encryptedBuffer = await client.file.download(message.file_id);

    // raw PGP bytes を base64 にエンコードして Worker へ渡す
    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const encryptedBase64 = bytesToBase64(encryptedBytes);

    // バイナリ復号（外側署名検証 + 復号 + 内側署名検証）
    const decryptedBase64Url = await workerDecryptBin(
      encryptedBase64,
      auth.privateKeys,
      auth.subPassphrase,
    );

    // base64url からバイナリに変換
    const bytes = fromBase64Url(decryptedBase64Url);

    return new Blob([bytes.buffer as ArrayBuffer], {
      type: message.fileMetadata.type,
    });
  };

  // 画像のインライン表示用: 復号してblob URLを生成しメッセージを更新する
  const loadImagePreview = async (message: Message) => {
    try {
      const blob = await decryptFileToBlob(message);
      if (!blob) return;
      const blobUrl = URL.createObjectURL(blob);
      chat.setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id ? { ...m, fileBlobUrl: blobUrl } : m,
        ),
      );
    } catch {
      // 画像プレビュー読み込み失敗は静かに無視
    }
  };

  // ユーザ操作によるファイル保存: 復号してブラウザダウンロードをトリガーする
  const handleDownloadFile = async (message: Message) => {
    if (!message.fileMetadata) return;
    try {
      // 既にblob URLがある画像は再ダウンロード不要
      if (message.fileBlobUrl) {
        const resp = await fetch(message.fileBlobUrl);
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = message.fileMetadata.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      const blob = await decryptFileToBlob(message);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = message.fileMetadata.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      showError(t("error.file_download_failed"));
    }
  };

  const handleLoadMore = async () => {
    if (!chatId || !threadId || loading) return;
    if (chat.messages.length >= chat.totalMessages) return;

    setLoading(true);
    try {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);

      const loaded = chat.messages.length;
      const from = -(loaded + 20);
      const until = -loaded;
      const data = await client.message.list(chatId, threadId, from, until);
      const rawMessages: Message[] = data.messages ?? [];
      const existingIds = new Set(chat.messages.map((m) => m.id));
      const newMessages = rawMessages.filter((m) => !existingIds.has(m.id));

      // 暗号化状態で先頭に追加し、プログレッシブに復号
      chat.setMessages((prev) => [
        ...newMessages.map((m) => ({ ...m, encrypted: true })),
        ...prev,
      ]);
      setLoading(false);

      const version = decryptVersionRef.current;
      await decryptMessagesProgressively(newMessages, version);
    } catch {
      showError(t("error.message_load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const currentUserId = auth.userId ?? "me";

  // SSR/初回マウント時はレイアウト未確定なので何も描画しない
  if (isMobile === undefined) return null;

  // モバイル: スタック表示（URLに基づいて表示を切り替え）
  if (isMobile) {
    if (isInfoRoute) {
      return <ChannelInfo chatId={chatId!} />;
    }
    if (chatId && threadId) {
      return (
        <ChatViewComponent
          threadName={selectedThreadName}
          currentUserId={currentUserId}
          memberProfiles={memberProfiles}
          loading={loading}
          onSend={handleSendMessage}
          onSendFile={handleSendFile}
          onDownloadFile={handleDownloadFile}
          onLoadMore={handleLoadMore}
          onBack={() => router.push(`/chat/${chatId}`)}
        />
      );
    }
    if (chatId) {
      return (
        <ThreadList
          groupName={selectedGroupName}
          onSelect={selectThread}
          onNew={handleNewThread}
          onBack={() => router.push("/")}
          onArchive={handleArchiveThread}
          onUnarchive={handleUnarchiveThread}
          archivedThreads={archivedThreads}
        />
      );
    }
    return (
      <ChatGroupList
        onSelect={selectGroup}
        onNew={handleNewGroup}
        onArchive={handleArchiveGroup}
        onUnarchive={handleUnarchiveGroup}
        archivedGroups={archivedGroups}
        onShowArchived={fetchArchivedGroups}
      />
    );
  }

  // PC: 3カラムレイアウト
  return (
    <div className="flex h-full max-w-[1400px] mx-auto w-full">
      <div className="w-80 border-r border-accent/30 flex-shrink-0">
        <ChatGroupList
          onSelect={selectGroup}
          onNew={handleNewGroup}
          onArchive={handleArchiveGroup}
          onUnarchive={handleUnarchiveGroup}
          archivedGroups={archivedGroups}
          onShowArchived={fetchArchivedGroups}
        />
      </div>
      <div className="w-80 border-r border-accent/30 flex-shrink-0">
        {isInfoRoute ? (
          <ChannelInfo chatId={chatId!} />
        ) : chatId ? (
          <ThreadList
            groupName={selectedGroupName}
            onSelect={selectThread}
            onNew={handleNewThread}
            onBack={() => router.push("/")}
            onArchive={handleArchiveThread}
            onUnarchive={handleUnarchiveThread}
            archivedThreads={archivedThreads}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            {t("chat.no_threads")}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {chatId && threadId ? (
          <ChatViewComponent
            threadName={selectedThreadName}
            currentUserId={currentUserId}
            memberProfiles={memberProfiles}
            loading={loading}
            onSend={handleSendMessage}
            onSendFile={handleSendFile}
            onDownloadFile={handleDownloadFile}
            onLoadMore={handleLoadMore}
            onBack={() => router.push(`/chat/${chatId}`)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            {t("chat.no_messages")}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatLayout;
