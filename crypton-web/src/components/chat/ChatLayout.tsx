"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { useDialogs, DialogComponent } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useServiceWorker } from "@/hooks/useServiceWorker";
import {
  authApiClient,
  apiClient,
  getApiBaseUrl,
  ApiError,
} from "@/api/client";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import ChatGroupList from "./ChatGroupList";
import ThreadList from "./ThreadList";
import ChatViewComponent from "./ChatView";
import Avatar from "@/components/common/Avatar";
import Dialog from "@/components/common/Dialog";
import { useNotification } from "@/contexts/NotificationContext";
import type { ChatGroup, Thread, Message } from "@/types/chat";
import type { Contact } from "@/types/contact";

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
        <div className="font-medium">{t("chat.new_group")}</div>
        <button
          type="button"
          onClick={close}
          className="text-muted hover:text-fg"
        >
          X
        </button>
      </div>
      <form
        className="px-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const name = fd.get("name") as string;
          if (!name) return;

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
            showError(t("error.group_create_failed"));
          }
        }}
      >
        <input
          name="name"
          placeholder={t("chat.group_name")}
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
                      {c.contact_user_id}
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
  const auth = useAuth();
  const chat = useChat();
  const { pushDialog } = useDialogs();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const { showNotification } = useNotification();
  const { showError } = useErrorToast();
  const [loading, setLoading] = useState(false);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [selectedThreadName, setSelectedThreadName] = useState("");
  const [archivedGroups, setArchivedGroups] = useState<ChatGroup[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  // メンバー署名公開鍵のキャッシュ（検証用、グループ選択時に取得）
  const knownPublicKeys = useRef<PublicKeyMap>({});
  // メンバー暗号化公開鍵のキャッシュ（暗号化用、グループ選択時に取得）
  const encryptionPublicKeys = useRef<string[]>([]);
  // メンバープロフィールのキャッシュ
  type MemberProfile = { display_name: string; icon_url: string | null };
  const [memberProfiles, setMemberProfiles] = useState<
    Record<string, MemberProfile>
  >({});

  // SWイベントハンドラ用のrefで最新値を参照
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const memberProfilesRef = useRef(memberProfiles);
  memberProfilesRef.current = memberProfiles;

  // SWからのPush通知イベントをリッスンしてUI更新
  const handleSwEvent = useCallback(
    async (data: {
      type: string;
      chat_id?: string;
      name?: string;
      sender_id?: string;
      encrypted?: string;
    }) => {
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);

      switch (data.type) {
        case "message": {
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
                    const bytes = Uint8Array.from(
                      atob(
                        result.data.payload
                          .replace(/-/g, "+")
                          .replace(/_/g, "/"),
                      ),
                      (c) => c.charCodeAt(0),
                    );
                    resolve(new TextDecoder().decode(bytes));
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
          let displayName = senderId;
          let iconUrl: string | null = null;
          const cached = memberProfilesRef.current[senderId];
          if (cached) {
            displayName = cached.display_name;
            iconUrl = cached.icon_url;
          } else {
            try {
              const profile = await apiClient().user.getProfile(senderId);
              displayName = profile.display_name || senderId;
              iconUrl = profile.icon_url
                ? `${getApiBaseUrl()}${profile.icon_url}`
                : null;
            } catch {
              // プロフィール取得失敗時はsenderIdを使用
            }
          }

          showNotification({ displayName, iconUrl, body });

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
              const decrypted = await decryptMessages(msgData.messages ?? []);
              chat.setMessages(decrypted);
              chat.setTotalMessages(msgData.total ?? 0);
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
    },
    [
      auth.getSignedMessage,
      auth.worker,
      auth.privateKeys,
      auth.subPassphrase,
      chat.setGroups,
      chat.setThreads,
      chat.setMessages,
      chat.setTotalMessages,
      showNotification,
    ],
  );

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
          const decrypted = await decryptMessages(msgData.messages ?? []);
          chat.setMessages(decrypted);
          chat.setTotalMessages(msgData.total ?? 0);
        }
      } catch {
        // failed to refresh on visibility change
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [auth.getSignedMessage, auth.worker, auth.privateKeys, auth.subPassphrase]);

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
      const profiles: Record<string, MemberProfile> = {};
      for (const member of data.members ?? []) {
        try {
          const keys = await apiClient().user.getKeys(member.user_id);
          pubKeys[keys.signing_key_id] = {
            name: member.user_id,
            publicKeys: keys.signing_public_key,
          };
          encPubKeys.push(keys.encryption_public_key);
        } catch {
          // 公開鍵を取得できないメンバーはスキップ
        }
        try {
          const profile = await apiClient().user.getProfile(member.user_id);
          profiles[member.user_id] = {
            display_name: profile.display_name || member.user_id,
            icon_url: profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}`
              : null,
          };
        } catch {
          profiles[member.user_id] = {
            display_name: member.user_id,
            icon_url: null,
          };
        }
      }
      knownPublicKeys.current = pubKeys;
      encryptionPublicKeys.current = encPubKeys;
      setMemberProfiles(profiles);
    },
    [auth.getSignedMessage, chat],
  );

  // chatIdが変わった時にグループ詳細を取得
  useEffect(() => {
    if (!chatId) return;
    // グループ名を設定
    const group = chat.groups.find((g) => g.id === chatId);
    if (group) setSelectedGroupName(group.name || group.id);
    fetchGroupDetail(chatId).catch(() => {});
  }, [chatId]);

  // threadIdが変わった時にメッセージを取得
  useEffect(() => {
    if (!chatId || !threadId) return;
    // スレッド名を設定
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
        const decrypted = await decryptMessages(data.messages ?? []);
        chat.setMessages(decrypted);
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
        const client = authApiClient(signed.signedMessage);
        await client.chat.unarchive(group.id);
        setArchivedGroups((prev) => prev.filter((g) => g.id !== group.id));
        // アクティブなグループ一覧をリフレッシュ
        const groups = await client.chat.list();
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
        setArchivedThreads((prev) => [...prev, { ...thread, archived_at: new Date().toISOString() }]);
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
        const client = authApiClient(signed.signedMessage);
        await client.thread.unarchive(chatId, thread.id);
        setArchivedThreads((prev) => prev.filter((t) => t.id !== thread.id));
        // アクティブなスレッド一覧をリフレッシュ
        const detail = await client.chat.get(chatId);
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
      setSelectedGroupName(group.name || group.id);
      router.push(`/chat/${group.id}`);
    },
    [router],
  );

  // スレッド選択
  const selectThread = useCallback(
    (thread: Thread) => {
      if (!chatId) return;
      setSelectedThreadName(thread.name || thread.id);
      router.push(`/chat/${chatId}/${thread.id}`);
    },
    [chatId, router],
  );

  // メッセージ復号ヘルパー（Worker経由）
  const decryptMessages = async (messages: Message[]): Promise<Message[]> => {
    if (!auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      return messages;
    }

    const results: Message[] = [];
    for (const msg of messages) {
      try {
        const decrypted = await new Promise<string>((resolve, reject) => {
          auth.worker!.eventWaiter("decrypt", (result) => {
            if (result.success) {
              const bytes = Uint8Array.from(
                atob(result.data.payload.replace(/-/g, "+").replace(/_/g, "/")),
                (c) => c.charCodeAt(0),
              );
              resolve(new TextDecoder().decode(bytes));
            } else {
              reject(new Error(result.message));
            }
          });
          auth.worker!.postMessage({
            call: "decrypt",
            passphrase: auth.subPassphrase!,
            privateKeys: auth.privateKeys!,
            knownPublicKeys: knownPublicKeys.current,
            message: msg.content,
          });
        });
        results.push({ ...msg, content: decrypted });
      } catch {
        results.push(msg);
      }
    }
    return results;
  };

  const handleNewGroup = () => {
    pushDialog(NewGroupDialog);
  };

  const handleNewThread = () => {
    pushDialog((p) => (
      <Dialog {...p} title={t("chat.new_thread")}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const name = fd.get("name") as string;
            if (!name || !chatId) return;

            const signed = await auth.getSignedMessage();
            if (!signed) return;
            try {
              const client = authApiClient(signed.signedMessage);
              const result = await client.chat.createThread(chatId, name);
              chat.setThreads([
                ...chat.threads,
                {
                  id: result.id,
                  chat_id: result.chat_id ?? chatId,
                  name,
                  created_by: signed.userId,
                  created_at: new Date().toISOString(),
                },
              ]);
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

  const handleSendMessage = async (text: string) => {
    if (!chatId || !threadId) return;

    const signed = await auth.getSignedMessage();
    if (!signed || !auth.worker || !auth.privateKeys || !auth.subPassphrase) {
      return;
    }

    if (encryptionPublicKeys.current.length === 0) {
      return;
    }

    try {
      const plainBase64 = btoa(
        String.fromCharCode(...new TextEncoder().encode(text)),
      );

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

      chat.setMessages([
        ...chat.messages,
        {
          id: result.id ?? crypto.randomUUID(),
          thread_id: threadId,
          sender_id: signed.userId,
          content: text,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch {
      showError(t("error.message_send_failed"));
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
      const from = -(loaded + 50);
      const until = -loaded;
      const data = await client.message.list(chatId, threadId, from, until);
      const decrypted = await decryptMessages(data.messages ?? []);
      chat.setMessages([...decrypted, ...chat.messages]);
    } catch {
      showError(t("error.message_load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const currentUserId = auth.userId ?? "me";

  // モバイル: スタック表示（URLに基づいて表示を切り替え）
  if (isMobile) {
    if (chatId && threadId) {
      return (
        <ChatViewComponent
          threadName={selectedThreadName}
          currentUserId={currentUserId}
          memberProfiles={memberProfiles}
          loading={loading}
          onSend={handleSendMessage}
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
    <div className="flex h-full">
      <div className="w-64 border-r border-accent/30 flex-shrink-0">
        <ChatGroupList
          onSelect={selectGroup}
          onNew={handleNewGroup}
          onArchive={handleArchiveGroup}
          onUnarchive={handleUnarchiveGroup}
          archivedGroups={archivedGroups}
          onShowArchived={fetchArchivedGroups}
        />
      </div>
      <div className="w-64 border-r border-accent/30 flex-shrink-0">
        {chatId ? (
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
