"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { z } from "zod";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useChat } from "@/contexts/ChatContext";
import { useDialogs, DialogComponent } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { authApiClient, apiClient, getApiBaseUrl } from "@/api/client";
import { displayUserId, Notification } from "@/utils/schema";
import {
  decodeBase64Url,
  encodeToBase64,
  fromBase64Url,
  bytesToBase64,
  base64ToBytes,
} from "@/utils/base64";
import {
  parseFileMetadata,
  buildFileMessageContent,
  isImageType,
} from "@/utils/fileMessage";
import { setCachedContactIds } from "@/utils/accountStore";
import { loadPushInbox, removePushInboxEntry } from "@/utils/pushInboxStore";
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
import { usePublicKeyResolver } from "@/hooks/usePublicKeyResolver";
import { useRealtime } from "@/contexts/RealtimeContext";
import type { ChatGroup, Thread, Message } from "@/types/chat";
import type { Contact } from "@/types/contact";

type Props = {
  chatId?: string;
  threadId?: string;
};

const PUSH_INBOX_FETCH_LIMIT = 100;
const PUSH_INBOX_POLL_INTERVAL_MS = 500;

/** メンバーの公開鍵キャッシュ: userId -> publicKeys (armored) */
type PublicKeyMap = Record<string, { name: string; publicKeys: string }>;

type ContactWithProfile = Contact & {
  display_name: string;
  icon_url: string | null;
  icon_signature: string;
  signing_public_key: string | null;
};

/** グループ作成ダイアログ（連絡先からメンバーを選択可能） */
const NewGroupDialog: DialogComponent = ({ close, setOnClose }) => {
  const auth = useAuth();
  const chatCtx = useChat();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const { resolveDisplayName: resolveName, resolveKeys } =
    usePublicKeyResolver();
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
                ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
                : null;
              const keys = await resolveKeys(c.contact_user_id);
              const name = await resolveName(
                c.contact_user_id,
                profile.display_name || c.contact_user_id,
                profile.display_name_signature || undefined,
              );
              return {
                ...c,
                display_name: name,
                icon_url: iconUrl,
                icon_signature: profile.icon_signature ?? "",
                signing_public_key: keys?.signing_public_key ?? null,
              };
            } catch {
              return {
                ...c,
                display_name: c.contact_user_id,
                icon_url: null,
                icon_signature: "",
                signing_public_key: null,
              };
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
                    iconSignature={c.icon_signature}
                    publicKey={c.signing_public_key ?? undefined}
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
  const realtime = useRealtime();
  const [loading, setLoading] = useState(false);
  const [realtimeFocused, setRealtimeFocused] = useState(false);
  const [selectedGroupName, setSelectedGroupName] = useState("");
  const [selectedThreadName, setSelectedThreadName] = useState("");
  const [archivedGroups, setArchivedGroups] = useState<ChatGroup[]>([]);
  const [archivedThreads, setArchivedThreads] = useState<Thread[]>([]);
  // 復号セッション: スレッド切替やメッセージ全件更新時にインクリメントし、
  // 進行中の復号をキャンセルする
  const decryptVersionRef = useRef(0);
  // fetchGroupDetailの完了を待つためのPromise
  const groupDetailReady = useRef<Promise<void>>(Promise.resolve());
  // メンバー署名公開鍵のキャッシュ（検証用、グループ選択時に取得）
  const knownPublicKeys = useRef<PublicKeyMap>({});
  // メンバー暗号化公開鍵のキャッシュ（暗号化用、グループ選択時に取得）
  const encryptionPublicKeys = useRef<string[]>([]);
  const encryptionPublicKeyByUser = useRef<Record<string, string>>({});
  // primary_key_fingerprint → user_id の逆引きマップ
  const fingerprintToUserId = useRef<Record<string, string>>({});
  // リトライ済みメッセージの追跡（重複防止）
  const retryingMessages = useRef<Set<string>>(new Set());
  // チャット/スレッド切替時の古い非同期レスポンスを無視するための世代番号
  const groupDetailVersionRef = useRef(0);
  const messageLoadVersionRef = useRef(0);
  // メンバープロフィールのキャッシュ
  type MemberProfile = {
    display_name: string;
    icon_url: string | null;
    icon_signature: string;
    signing_public_key: string | null;
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
  const processingPushInboxRef = useRef(false);

  const handleRealtimeOffer = useCallback(
    async (data: {
      chat_id?: string;
      session_id?: string;
      sender_id?: string;
      name?: string;
      encrypted?: string;
    }): Promise<boolean> => {
      if (!data.encrypted || !data.session_id || !data.sender_id || !data.name)
        return true;
      if (
        realtime.activeSession?.sessionId === data.session_id ||
        realtime.pendingSessions.some((s) => s.sessionId === data.session_id)
      ) {
        return true;
      }

      if (auth.worker && auth.privateKeys && auth.subPassphrase) {
        try {
          const decrypted = await new Promise<string>((resolve, reject) => {
            auth.worker!.eventWaiter("decrypt", (result: any) => {
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
          const parsed = JSON.parse(decrypted) as {
            sdp?: string;
            publicKey?: string;
          };
          if (!parsed.sdp) return true;
          realtime.addPendingSession({
            sessionId: data.session_id,
            chatId: data.chat_id ?? "",
            name: data.name,
            createdBy: data.sender_id,
            offer: {
              sdp: parsed.sdp,
              publicKey: parsed.publicKey,
            },
          });
          return true;
        } catch {
          // 復号失敗
          return false;
        }
      }
      return false;
    },
    [
      auth.privateKeys,
      auth.subPassphrase,
      auth.worker,
      realtime.activeSession?.sessionId,
      realtime.addPendingSession,
      realtime.pendingSessions,
    ],
  );

  const handlePushEvent = useCallback(
    async (data: z.infer<typeof Notification>): Promise<boolean> => {
      switch (data.type) {
        case "message": {
          // 自己メッセージの場合、送信側の楽観的追加で処理するため
          // メッセージリストの再取得をスキップ（ファイル送信時に完了前に表示されるのを防ぐ）
          if (data.is_self) return true;

          // message_id からメッセージ本体を取得し、Worker経由で復号
          let body = "New message";
          if (
            data.chat_id &&
            data.thread_id &&
            data.message_id &&
            auth.worker &&
            auth.privateKeys &&
            auth.subPassphrase
          ) {
            try {
              const signed = await auth.getSignedMessage();
              if (signed) {
                const client = authApiClient(signed.signedMessage);
                const msg = await client.message.get(
                  data.chat_id,
                  data.thread_id,
                  data.message_id,
                );
                if (typeof msg.content === "string" && msg.content.length > 0) {
                  const decryptWithKnownKeys = async (): Promise<string> =>
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
                        passphrase: auth.subPassphrase!,
                        privateKeys: auth.privateKeys!,
                        knownPublicKeys: knownPublicKeys.current,
                        message: msg.content,
                      });
                    });

                  try {
                    body = await decryptWithKnownKeys();
                  } catch {
                    // チャット未選択時などに送信者鍵が未キャッシュなケースを補完して再試行
                    if (data.sender_id) {
                      const senderKeys = await resolveKeys(data.sender_id);
                      if (senderKeys) {
                        knownPublicKeys.current = {
                          ...knownPublicKeys.current,
                          [senderKeys.primary_key_fingerprint]: {
                            name: data.sender_id,
                            publicKeys: senderKeys.signing_public_key,
                          },
                        };
                        body = await decryptWithKnownKeys();
                      }
                    }
                  }
                }
              }
            } catch {
              // 復号失敗時はデフォルトのbodyを使用
            }
          }

          // 現在表示中のチャットと一致する場合、メッセージリストを再取得
          // 失敗時はInboxを残して再試行し、SW通知抑止による取りこぼしを防ぐ
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
              if (!signed2) return false;
              const client2 = authApiClient(signed2.signedMessage);
              const msgData = await client2.message.list(
                currentChatId,
                currentThreadId,
              );
              const rawMessages: Message[] = msgData.messages ?? [];
              chat.setTotalMessages(msgData.total ?? 0);
              await mergeAndDecryptNewMessages(rawMessages);
            } catch {
              return false;
            }
          }

          // 送信者プロフィールを取得（キャッシュまたはAPI）
          const senderId = data.sender_id ?? "unknown";
          let displayName = displayUserId(senderId);
          let iconUrl: string | null = null;
          let iconSignature: string | null = null;
          let publicKey: string | undefined;
          const cached = memberProfilesRef.current[senderId];
          if (cached) {
            displayName = cached.display_name;
            iconUrl = cached.icon_url;
            iconSignature = cached.icon_signature;
            publicKey = cached.signing_public_key ?? undefined;
          } else if (data.sender_name) {
            // サーバが平文解決済みの sender_name を付与している場合はそれを使う
            displayName = data.sender_name;
            try {
              const [profile, keys] = await Promise.all([
                apiClient().user.getProfile(senderId),
                resolveKeys(senderId),
              ]);
              iconUrl = profile.icon_url
                ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
                : null;
              iconSignature = profile.icon_signature ?? "";
              publicKey = keys?.signing_public_key ?? undefined;
            } catch {
              // アイコン取得失敗は無視
            }
          } else {
            try {
              const [profile, keys] = await Promise.all([
                apiClient().user.getProfile(senderId),
                resolveKeys(senderId),
              ]);
              displayName = await resolveDisplayName(
                senderId,
                profile.display_name || displayUserId(senderId),
                profile.display_name_signature || undefined,
              );
              iconUrl = profile.icon_url
                ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
                : null;
              iconSignature = profile.icon_signature ?? "";
              publicKey = keys?.signing_public_key ?? undefined;
            } catch {
              // プロフィール取得失敗時はsenderIdを使用
            }
          }

          showNotification({
            displayName,
            iconUrl,
            iconSignature,
            publicKey,
            body,
          });

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

          return true;
        }
        case "added_to_group": {
          try {
            const signed = await auth.getSignedMessage();
            if (!signed) return false;
            const client = authApiClient(signed.signedMessage);
            const groups = await client.chat.list();
            chat.setGroups(groups);
          } catch {
            return false;
          }
          return true;
        }
        case "new_thread": {
          const currentChatId = chatIdRef.current;
          if (currentChatId && data.chat_id && currentChatId === data.chat_id) {
            try {
              const signed = await auth.getSignedMessage();
              if (!signed) return false;
              const client = authApiClient(signed.signedMessage);
              const detail = await client.chat.get(data.chat_id);
              chat.setThreads(detail.threads ?? []);
            } catch {
              return false;
            }
          }
          return true;
        }
        case "realtime_offer": {
          return handleRealtimeOffer(data);
        }
        case "realtime_answer": {
          if (!data.session_id || !data.sender_id || !data.answer) {
            return false;
          }
          try {
            await realtime.handleIncomingAnswer(
              data.session_id,
              data.sender_id,
              data.answer,
            );
          } catch {
            return false;
          }
          return true;
        }
      }
      return false;
    },
    [
      auth.getSignedMessage,
      auth.privateKeys,
      auth.subPassphrase,
      auth.worker,
      chat,
      handleRealtimeOffer,
      resolveDisplayName,
      resolveKeys,
      realtime.handleIncomingAnswer,
      showNotification,
    ],
  );

  // Push受信データをIndexedDBから高頻度で回収して処理
  useEffect(() => {
    let disposed = false;
    const processInbox = async () => {
      if (disposed || processingPushInboxRef.current) return;
      processingPushInboxRef.current = true;
      try {
        const entries = await loadPushInbox(PUSH_INBOX_FETCH_LIMIT);
        for (const entry of entries) {
          if (disposed) return;
          const processed = await handlePushEvent(entry.notification);
          if (processed) {
            await removePushInboxEntry(entry.key);
          }
        }
      } catch {
        // failed to process push inbox
      } finally {
        processingPushInboxRef.current = false;
      }
    };
    const triggerProcessInbox = () => {
      void processInbox();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerProcessInbox();
      }
    };
    const onFocus = () => {
      triggerProcessInbox();
    };
    const onPageShow = () => {
      triggerProcessInbox();
    };

    triggerProcessInbox();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    const intervalId = window.setInterval(
      triggerProcessInbox,
      PUSH_INBOX_POLL_INTERVAL_MS,
    );

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(intervalId);
    };
  }, [handlePushEvent]);

  // iOS SafariではSWからのpostMessageが届かない場合があるため、
  // 可視化・フォーカス復帰時にデータを再取得するフォールバック
  useEffect(() => {
    const refreshFromServer = async () => {
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

    const onVisibilityChange = () => {
      void refreshFromServer();
    };
    const onFocus = () => {
      void refreshFromServer();
    };
    const onPageShow = () => {
      void refreshFromServer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
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
      const requestVersion = ++groupDetailVersionRef.current;
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);
      const data = await client.chat.get(groupId);
      if (
        chatIdRef.current !== groupId ||
        groupDetailVersionRef.current !== requestVersion
      ) {
        return;
      }
      chat.setThreads(data.threads ?? []);
      setArchivedThreads(data.archived_threads ?? []);

      const pubKeys: PublicKeyMap = {};
      const encPubKeys: string[] = [];
      const encPubKeyMap: Record<string, string> = {};
      const fingerprintMap: Record<string, string> = {};
      const profiles: Record<string, MemberProfile> = {};
      for (const member of data.members ?? []) {
        let signingKey: string | null = null;
        try {
          const resolved = await resolveKeys(member.user_id);
          if (resolved) {
            pubKeys[resolved.primary_key_fingerprint] = {
              name: member.user_id,
              publicKeys: resolved.signing_public_key,
            };
            encPubKeys.push(resolved.encryption_public_key);
            encPubKeyMap[member.user_id] = resolved.encryption_public_key;
            fingerprintMap[resolved.primary_key_fingerprint] = member.user_id;
            signingKey = resolved.signing_public_key;
          }
        } catch {
          // 公開鍵を取得できないメンバーはスキップ
        }
        try {
          const profile = await apiClient().user.getProfile(member.user_id);
          const resolvedName = await resolveDisplayName(
            member.user_id,
            profile.display_name || member.user_id,
            profile.display_name_signature || undefined,
          );
          profiles[member.user_id] = {
            display_name: resolvedName,
            icon_url: profile.icon_url
              ? `${getApiBaseUrl()}${profile.icon_url}?t=${Date.now()}`
              : null,
            icon_signature: profile.icon_signature ?? "",
            signing_public_key: signingKey,
            status: profile.status ?? "",
          };
        } catch {
          profiles[member.user_id] = {
            display_name: member.user_id,
            icon_url: null,
            icon_signature: "",
            signing_public_key: signingKey,
            status: "",
          };
        }
      }
      if (
        chatIdRef.current !== groupId ||
        groupDetailVersionRef.current !== requestVersion
      ) {
        return;
      }
      knownPublicKeys.current = pubKeys;
      encryptionPublicKeys.current = encPubKeys;
      encryptionPublicKeyByUser.current = encPubKeyMap;
      fingerprintToUserId.current = fingerprintMap;
      setMemberProfiles(profiles);
    },
    [auth.getSignedMessage, auth.userId, chat, resolveKeys, resolveDisplayName],
  );

  // chatIdが変わった時にグループ詳細を取得
  useEffect(() => {
    if (!chatId) return;
    const group = chat.groups.find((g) => g.id === chatId);
    if (group) setSelectedGroupName(group.name || group.id);
    groupDetailReady.current = fetchGroupDetail(chatId).catch(() => {});
  }, [chatId]);

  // threadIdが変わった時にメッセージを取得
  useEffect(() => {
    if (!chatId || !threadId) {
      messageLoadVersionRef.current += 1;
      return;
    }
    const requestVersion = ++messageLoadVersionRef.current;
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
        if (
          chatIdRef.current !== chatId ||
          threadIdRef.current !== threadId ||
          messageLoadVersionRef.current !== requestVersion
        ) {
          return;
        }
        chat.setTotalMessages(data.total ?? 0);

        // 暗号化状態のメッセージを即座に表示し、プログレッシブに復号
        const rawMessages: Message[] = data.messages ?? [];
        chat.setMessages(rawMessages.map((m) => ({ ...m, encrypted: true })));
        setLoading(false);

        // メンバー公開鍵の取得完了を待ってから復号を開始
        await groupDetailReady.current;
        if (
          chatIdRef.current !== chatId ||
          threadIdRef.current !== threadId ||
          messageLoadVersionRef.current !== requestVersion
        ) {
          return;
        }

        const version = ++decryptVersionRef.current;
        await decryptMessagesProgressively(rawMessages, version);
      } catch {
        if (messageLoadVersionRef.current === requestVersion) {
          showError(t("error.message_load_failed"));
        }
      } finally {
        if (messageLoadVersionRef.current === requestVersion) {
          setLoading(false);
        }
      }
    })();
  }, [chatId, threadId]);

  useEffect(() => {
    const current = realtime.activeSession;
    const isRealtimeView =
      !!chatId && !threadId && current?.chatId === chatId && realtimeFocused;
    if (!isRealtimeView || !auth.userId) return;
    const currentUserId = auth.userId;

    setSelectedThreadName(current.name);
    const mapped: Message[] = realtime.realtimeMessages.map((m) => ({
      id: m.id,
      thread_id: "",
      sender_id: m.senderId === "self" ? currentUserId : m.senderId,
      content: m.content,
      created_at: new Date(m.timestamp).toISOString(),
    }));
    chat.setMessages(mapped);
    chat.setTotalMessages(mapped.length);
  }, [
    auth.userId,
    chatId,
    realtime.activeSession,
    realtime.realtimeMessages,
    realtimeFocused,
    threadId,
  ]);

  useEffect(() => {
    if (!realtime.activeSession) {
      setRealtimeFocused(false);
    }
  }, [realtime.activeSession]);

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
      setRealtimeFocused(false);
      setSelectedGroupName(group.name || group.id);
      chat.markGroupRead(group.id);
      router.push(`/chat/${group.id}`);
    },
    [router, chat.markGroupRead],
  );

  // スレッド選択
  const selectThread = useCallback(
    (thread: Thread) => {
      if (!chatId) return;
      setRealtimeFocused(false);
      setSelectedThreadName(thread.name || thread.id);
      chat.markThreadRead(thread.id);
      router.push(`/chat/${chatId}/${thread.id}`);
    },
    [chatId, router, chat.markThreadRead],
  );

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
  const decryptOne = async (
    msg: Message,
  ): Promise<{
    content: string;
    failed: boolean;
    errorMessage?: string;
  }> => {
    try {
      const decrypted = await workerDecrypt(
        msg.content,
        auth.privateKeys!,
        auth.subPassphrase!,
      );
      return { content: decrypted, failed: false };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : undefined;
      return { content: msg.content, failed: true, errorMessage };
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
  ): Promise<{
    content: string;
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
      return await decryptOne(msg);
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

    const allDecrypted: Message[] = [];

    // 最新のメッセージから順に復号
    for (let i = messages.length - 1; i >= 0; i--) {
      if (decryptVersionRef.current !== version) return allDecrypted;

      const msg = messages[i];
      let result = await decryptOne(msg);

      // 鍵関連エラーの場合、鍵を再取得してリトライ
      if (result.failed && isKeyRelatedError(result.errorMessage)) {
        const retryResult = await handleKeyRefreshAndRetry(
          msg,
          result.errorMessage,
        );
        if (retryResult) result = retryResult;
      }

      if (decryptVersionRef.current !== version) return allDecrypted;

      {
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

    const allDecrypted: Message[] = [];

    for (const msg of newRawMessages) {
      try {
        let result = await decryptOne(msg);

        // 鍵関連エラーの場合、鍵を再取得してリトライ
        if (result.failed && isKeyRelatedError(result.errorMessage)) {
          const retryResult = await handleKeyRefreshAndRetry(
            msg,
            result.errorMessage,
          );
          if (retryResult) result = retryResult;
        }

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

  const handleJoinRealtime = useCallback(
    async (sessionId: string) => {
      if (realtime.activeSession?.sessionId === sessionId) {
        setRealtimeFocused(true);
        return;
      }
      await realtime.joinSession(sessionId);
      setRealtimeFocused(true);
    },
    [realtime.activeSession, realtime.joinSession],
  );

  const handleLeaveRealtime = useCallback(
    (sessionId: string) => {
      if (realtime.activeSession?.sessionId === sessionId) {
        realtime.leaveSession();
        setRealtimeFocused(false);
      } else {
        realtime.removePendingSession(sessionId);
      }
    },
    [
      realtime.activeSession,
      realtime.leaveSession,
      realtime.removePendingSession,
    ],
  );

  const handleNewThread = () => {
    pushDialog((p) => {
      const [threadName, setThreadName] = useState("");
      const [isRealtimeSession, setIsRealtimeSession] = useState(false);
      const [isSubmitting, setIsSubmitting] = useState(false);
      return (
        <Dialog {...p} title={t("chat.new_thread")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (isSubmitting) return;
              const fd = new FormData(e.currentTarget);
              const name = fd.get("name") as string;
              if (!name || !chatId) return;
              setIsSubmitting(true);

              try {
                if (isRealtimeSession) {
                  // リアルタイムセッション開始
                  const memberIds = Object.keys(memberProfiles).filter(
                    (id) => id !== auth.userId,
                  );
                  const memberPublicKeys = Object.fromEntries(
                    memberIds
                      .map((id) => [id, encryptionPublicKeyByUser.current[id]])
                      .filter(([, key]) => !!key),
                  ) as Record<string, string>;
                  await realtime.startSession(
                    chatId,
                    name,
                    memberIds,
                    memberPublicKeys,
                  );
                  setRealtimeFocused(true);
                  p.close();
                } else {
                  // 通常スレッド作成
                  const signed = await auth.getSignedMessage();
                  if (!signed) return;
                  const client = authApiClient(signed.signedMessage);
                  const result = await client.chat.createThread(chatId, name);
                  const newThread: Thread = {
                    id: result.id,
                    chat_id: result.chat_id ?? chatId,
                    name,
                    created_by: signed.userId,
                    created_at: new Date().toISOString(),
                  };
                  chat.setThreads([...chat.threads, newThread]);
                  p.close();
                }
              } catch {
                showError(t("error.unknown"));
              } finally {
                setIsSubmitting(false);
              }
            }}
          >
            <input
              name="name"
              placeholder={t("chat.thread_name")}
              className="w-full border border-accent/30 rounded px-3 py-2 mb-3 bg-transparent"
              disabled={isSubmitting}
              onChange={(e) => setThreadName(e.target.value)}
            />
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isRealtimeSession}
                onChange={(e) => setIsRealtimeSession(e.target.checked)}
                disabled={isSubmitting}
                className="accent-accent"
              />
              <span className="text-sm">{t("realtime.session")}</span>
            </label>
            {isRealtimeSession && (
              <p className="text-xs text-muted mb-3">
                {t("realtime.start_desc")}
              </p>
            )}
            <button
              type="submit"
              disabled={!threadName.trim() || isSubmitting}
              className="px-4 py-2 bg-accent/30 rounded hover:bg-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center justify-center">
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                </span>
              ) : isRealtimeSession ? (
                t("realtime.start")
              ) : (
                t("common.ok")
              )}
            </button>
          </form>
        </Dialog>
      );
    });
  };

  const handleSendMessage = async (text: string) => {
    if (!chatId) return;

    const inRealtimeMode =
      !threadId && realtime.activeSession?.chatId === chatId;
    if (inRealtimeMode) {
      try {
        await realtime.sendRealtimeMessage(text);
      } catch {
        showError(t("error.realtime_connection_failed"));
      }
      return;
    }
    if (!threadId) return;

    const signed = await auth.getSignedMessage();
    if (!signed || !auth.worker || !auth.privateKeys || !auth.subPassphrase) {
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
  const activeRealtimeSession = realtime.activeSession;
  const isRealtimeView =
    !!chatId &&
    !threadId &&
    activeRealtimeSession?.chatId === chatId &&
    realtimeFocused;
  const chatViewThreadName = isRealtimeView
    ? activeRealtimeSession.name
    : selectedThreadName;
  const chatInputPlaceholder = isRealtimeView
    ? t("realtime.placeholder")
    : t("chat.placeholder");
  const handleBackFromChatView = () => {
    if (!chatId) return;
    if (isRealtimeView) setRealtimeFocused(false);
    router.push(`/chat/${chatId}`);
  };

  // SSR/初回マウント時はレイアウト未確定なので何も描画しない
  if (isMobile === undefined) return null;

  // モバイル: スタック表示（URLに基づいて表示を切り替え）
  if (isMobile) {
    if (isInfoRoute) {
      return <ChannelInfo chatId={chatId!} />;
    }
    if (chatId && (threadId || isRealtimeView)) {
      return (
        <ChatViewComponent
          threadName={chatViewThreadName}
          currentUserId={currentUserId}
          memberProfiles={memberProfiles}
          loading={loading}
          onSend={handleSendMessage}
          onSendFile={isRealtimeView ? undefined : handleSendFile}
          onDownloadFile={isRealtimeView ? undefined : handleDownloadFile}
          onLoadMore={isRealtimeView ? async () => {} : handleLoadMore}
          inputPlaceholder={chatInputPlaceholder}
          onBack={handleBackFromChatView}
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
          onJoinRealtime={handleJoinRealtime}
          onLeaveRealtime={handleLeaveRealtime}
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
            onJoinRealtime={handleJoinRealtime}
            onLeaveRealtime={handleLeaveRealtime}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted text-sm">
            {t("chat.no_threads")}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {chatId && (threadId || isRealtimeView) ? (
          <ChatViewComponent
            threadName={chatViewThreadName}
            currentUserId={currentUserId}
            memberProfiles={memberProfiles}
            loading={loading}
            onSend={handleSendMessage}
            onSendFile={isRealtimeView ? undefined : handleSendFile}
            onDownloadFile={isRealtimeView ? undefined : handleDownloadFile}
            onLoadMore={isRealtimeView ? async () => {} : handleLoadMore}
            inputPlaceholder={chatInputPlaceholder}
            onBack={handleBackFromChatView}
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
