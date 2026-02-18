"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { authApiClient } from "@/api/client";
import { encodeToBase64 } from "@/utils/base64";
import type {
  RealtimeSession,
  RealtimeMessage,
  RealtimeSessionCallbacks,
} from "@/utils/realtimeSession";
import {
  generateTempKeys,
  createOffersForMembers,
  acceptOffer,
  handleAnswer,
  sendMessage as rtSendMessage,
  destroy,
} from "@/utils/realtimeSession";

export type PendingSession = {
  sessionId: string;
  chatId: string;
  name: string;
  createdBy: string;
  /** 復号済みの SDP（公開鍵はDataChannel確立後の key_exchange で交換） */
  offer: { sdp: string; publicKey?: string };
};

type RealtimeContextType = {
  activeSession: RealtimeSession | null;
  pendingSessions: PendingSession[];
  addPendingSession: (session: PendingSession) => void;
  removePendingSession: (sessionId: string) => void;
  startSession: (
    chatId: string,
    name: string,
    memberIds: string[],
    memberPublicKeys: Record<string, string>,
  ) => Promise<void>;
  joinSession: (sessionId: string) => Promise<void>;
  leaveSession: () => void;
  handleIncomingAnswer: (
    sessionId: string,
    fromUserId: string,
    answerSdp: string,
  ) => Promise<void>;
  sendRealtimeMessage: (text: string) => Promise<void>;
  realtimeMessages: RealtimeMessage[];
  connectedPeers: string[];
};

const RealtimeContext = createContext<RealtimeContextType>({
  activeSession: null,
  pendingSessions: [],
  addPendingSession: () => {},
  removePendingSession: () => {},
  startSession: async () => {},
  joinSession: async () => {},
  leaveSession: () => {},
  handleIncomingAnswer: async () => {},
  sendRealtimeMessage: async () => {},
  realtimeMessages: [],
  connectedPeers: [],
});

export const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const auth = useAuth();
  const [activeSession, setActiveSession] = useState<RealtimeSession | null>(
    null,
  );
  const [pendingSessions, setPendingSessions] = useState<PendingSession[]>([]);
  const [realtimeMessages, setRealtimeMessages] = useState<RealtimeMessage[]>(
    [],
  );
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const sessionRef = useRef<RealtimeSession | null>(null);

  const addPendingSession = useCallback((session: PendingSession) => {
    setPendingSessions((prev) => {
      if (prev.some((s) => s.sessionId === session.sessionId)) return prev;
      return [...prev, session];
    });
  }, []);

  const removePendingSession = useCallback((sessionId: string) => {
    setPendingSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  const callbacks: RealtimeSessionCallbacks = {
    onMessage: (msg) => {
      setRealtimeMessages((prev) => [...prev, msg]);
    },
    onPeerJoin: (userId) => {
      setConnectedPeers((prev) =>
        prev.includes(userId) ? prev : [...prev, userId],
      );
    },
    onPeerLeave: (userId) => {
      setConnectedPeers((prev) => prev.filter((id) => id !== userId));
    },
  };

  const startSession = useCallback(
    async (
      chatId: string,
      name: string,
      memberIds: string[],
      memberPublicKeys: Record<string, string>,
    ) => {
      if (
        !auth.worker ||
        !auth.userId ||
        !auth.privateKeys ||
        !auth.subPassphrase
      )
        return;

      // 一時PGP鍵を生成
      const tempKeys = await generateTempKeys(auth.worker, auth.userId);

      const session: RealtimeSession = {
        selfId: auth.userId,
        sessionId: "",
        chatId,
        name,
        isCreator: true,
        creatorId: auth.userId,
        tempPrivateKey: tempKeys.privateKey,
        tempPassphrase: tempKeys.passphrase,
        tempPublicKey: tempKeys.publicKey,
        peers: new Map(),
        dataChannels: new Map(),
        peerPublicKeys: new Map(),
        callbacks,
      };

      const targetMemberIds = memberIds.filter((id) => !!memberPublicKeys[id]);
      if (targetMemberIds.length === 0) return;

      // 各メンバー向けの SDP Offer を生成
      const offers = await createOffersForMembers(session, targetMemberIds);

      // 各メンバーの永続公開鍵で SDP を暗号化
      const encrypted: Record<string, string> = {};
      for (let i = 0; i < targetMemberIds.length; i++) {
        const memberId = targetMemberIds[i];
        const offer = offers.get(memberId);
        const memberPublicKey = memberPublicKeys[memberId];
        if (!offer || !memberPublicKey) continue;

        const plainData = JSON.stringify({
          sdp: offer.sdp,
        });
        const plainBase64 = encodeToBase64(plainData);

        const encryptedData = await new Promise<string>((resolve, reject) => {
          auth.worker!.eventWaiter("encrypt", (result: any) => {
            if (result.success) resolve(result.data.message);
            else reject(new Error(result.message));
          });
          auth.worker!.postMessage({
            call: "encrypt",
            passphrase: auth.subPassphrase!,
            privateKeys: auth.privateKeys!,
            publicKeys: [memberPublicKey],
            payload: plainBase64,
          });
        });

        encrypted[memberId] = encryptedData;
      }

      // サーバにPush通知を送信
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);
      const resp = await client.realtime.start(chatId, name, encrypted);
      session.sessionId = resp.session_id;

      sessionRef.current = session;
      setActiveSession(session);
      setRealtimeMessages([]);
      setConnectedPeers([]);
    },
    [auth],
  );

  const joinSession = useCallback(
    async (sessionId: string) => {
      if (!auth.worker || !auth.userId) return;

      const pending = pendingSessions.find((s) => s.sessionId === sessionId);
      if (!pending) return;

      // 一時PGP鍵を生成
      const tempKeys = await generateTempKeys(auth.worker, auth.userId);

      const session: RealtimeSession = {
        selfId: auth.userId,
        sessionId,
        chatId: pending.chatId,
        name: pending.name,
        isCreator: false,
        creatorId: pending.createdBy,
        tempPrivateKey: tempKeys.privateKey,
        tempPassphrase: tempKeys.passphrase,
        tempPublicKey: tempKeys.publicKey,
        peers: new Map(),
        dataChannels: new Map(),
        peerPublicKeys: new Map(),
        callbacks,
      };

      // 互換性: offerに公開鍵が含まれる場合のみ事前登録
      if (pending.offer.publicKey) {
        session.peerPublicKeys.set(pending.createdBy, pending.offer.publicKey);
      }

      // 作成者の Offer に Answer を返す
      const answer = await acceptOffer(
        session,
        pending.createdBy,
        pending.offer.sdp,
        auth.worker,
      );
      const signed = await auth.getSignedMessage();
      if (!signed) return;
      const client = authApiClient(signed.signedMessage);
      await client.realtime.answer(
        pending.chatId,
        sessionId,
        pending.createdBy,
        answer.sdp,
      );

      sessionRef.current = session;
      setActiveSession(session);
      setRealtimeMessages([]);
      setConnectedPeers([]);

      // 一覧から除去
      setPendingSessions((prev) =>
        prev.filter((s) => s.sessionId !== sessionId),
      );
    },
    [auth, pendingSessions],
  );

  const leaveSession = useCallback(() => {
    if (sessionRef.current) {
      destroy(sessionRef.current);
      sessionRef.current = null;
    }
    setActiveSession(null);
    setRealtimeMessages([]);
    setConnectedPeers([]);
  }, []);

  const handleIncomingAnswer = useCallback(
    async (sessionId: string, fromUserId: string, answerSdp: string) => {
      if (!auth.worker) return;
      const session = sessionRef.current;
      if (!session || !session.isCreator || session.sessionId !== sessionId) {
        return;
      }
      await handleAnswer(session, fromUserId, answerSdp, auth.worker);
    },
    [auth.worker],
  );

  const sendRealtimeMessage = useCallback(
    async (text: string) => {
      if (!sessionRef.current || !auth.worker) return;
      const msg = await rtSendMessage(sessionRef.current, text, auth.worker);
      if (msg) {
        setRealtimeMessages((prev) => [...prev, msg]);
      }
    },
    [auth.worker],
  );

  return (
    <RealtimeContext.Provider
      value={{
        activeSession,
        pendingSessions,
        addPendingSession,
        removePendingSession,
        startSession,
        joinSession,
        leaveSession,
        handleIncomingAnswer,
        sendRealtimeMessage,
        realtimeMessages,
        connectedPeers,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
};

export const useRealtime = () => useContext(RealtimeContext);
