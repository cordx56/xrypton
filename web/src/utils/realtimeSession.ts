// WebRTC セッション管理モジュール
// メッシュトポロジーのP2P接続を管理し、作成者がシグナリングハブとして機能する。

import type { WorkerEventWaiter } from "@/hooks/useWorker";
import type { WorkerCallMessage } from "@/utils/schema";
import type { z } from "zod";
import { encodeToBase64, decodeBase64Url } from "@/utils/base64";

const STUN_SERVER = "stun:stun.l.google.com:19302";

export type RealtimeMessage = {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
};

export type DataChannelMessage =
  | { type: "message"; encrypted: string }
  | { type: "key_exchange"; publicKey: string }
  | { type: "leave" }
  | { type: "new_peer"; userId: string }
  | {
      type: "offer_relay";
      fromUserId: string;
      toUserId: string;
      sdp: string;
      ice: string[];
    }
  | {
      type: "answer_relay";
      fromUserId: string;
      toUserId: string;
      sdp: string;
      ice: string[];
    };

export type RealtimeSessionCallbacks = {
  onMessage: (msg: RealtimeMessage) => void;
  onPeerJoin: (userId: string) => void;
  onPeerLeave: (userId: string) => void;
};

export type RealtimeSession = {
  selfId: string;
  sessionId: string;
  chatId: string;
  name: string;
  isCreator: boolean;
  creatorId: string;
  tempPrivateKey: string;
  tempPassphrase: string;
  tempPublicKey: string;
  peers: Map<string, RTCPeerConnection>;
  dataChannels: Map<string, RTCDataChannel>;
  peerPublicKeys: Map<string, string>;
  callbacks: RealtimeSessionCallbacks;
};

export type WorkerLike = {
  eventWaiter: WorkerEventWaiter;
  postMessage: (message: z.infer<typeof WorkerCallMessage>) => void;
};

// ICE candidate の収集完了を待機する
async function waitForIceGathering(
  pc: RTCPeerConnection,
): Promise<RTCSessionDescriptionInit> {
  if (pc.iceGatheringState === "complete") {
    return pc.localDescription!;
  }
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve(pc.localDescription!);
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    // タイムアウト: 10秒で切り上げ
    setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve(pc.localDescription!);
    }, 10000);
  });
}

// Worker経由でPGP鍵を生成し、{privateKey, publicKey, passphrase}を返す
export async function generateTempKeys(
  worker: WorkerLike,
  userId: string,
): Promise<{ privateKey: string; publicKey: string; passphrase: string }> {
  const passphrase = crypto.randomUUID();

  const keys = await new Promise<string>((resolve, reject) => {
    worker.eventWaiter("generate", (result) => {
      if (result.success) resolve(result.data.keys);
      else reject(new Error(result.message));
    });
    worker.postMessage({
      call: "generate",
      userId,
      mainPassphrase: passphrase,
      subPassphrase: passphrase,
    });
  });

  const publicKey = await new Promise<string>((resolve, reject) => {
    worker.eventWaiter("export_public_keys", (result) => {
      if (result.success) resolve(result.data.keys);
      else reject(new Error(result.message));
    });
    worker.postMessage({ call: "export_public_keys", keys });
  });

  return { privateKey: keys, publicKey, passphrase };
}

function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: STUN_SERVER }],
  });
}

// Data Channel のメッセージハンドラをセットアップ
function setupDataChannel(
  session: RealtimeSession,
  channel: RTCDataChannel,
  peerId: string,
  worker: WorkerLike,
) {
  channel.onmessage = async (event) => {
    try {
      const msg: DataChannelMessage = JSON.parse(event.data);
      await handleDataChannelMessage(session, peerId, msg, worker);
    } catch {
      // 不正なメッセージは無視
    }
  };
  channel.onclose = () => {
    session.peers.delete(peerId);
    session.dataChannels.delete(peerId);
    session.peerPublicKeys.delete(peerId);
    session.callbacks.onPeerLeave(peerId);
  };
}

async function handleDataChannelMessage(
  session: RealtimeSession,
  fromUserId: string,
  msg: DataChannelMessage,
  worker: WorkerLike,
) {
  switch (msg.type) {
    case "message": {
      // 一時鍵で復号
      try {
        const decrypted = await workerDecrypt(
          worker,
          msg.encrypted,
          session.tempPrivateKey,
          session.tempPassphrase,
          session.peerPublicKeys,
        );
        session.callbacks.onMessage({
          id: crypto.randomUUID(),
          senderId: fromUserId,
          content: decrypted,
          timestamp: Date.now(),
        });
      } catch {
        // 復号失敗
      }
      break;
    }
    case "key_exchange": {
      session.peerPublicKeys.set(fromUserId, msg.publicKey);
      break;
    }
    case "leave": {
      const pc = session.peers.get(fromUserId);
      if (pc) pc.close();
      session.peers.delete(fromUserId);
      session.dataChannels.delete(fromUserId);
      session.peerPublicKeys.delete(fromUserId);
      session.callbacks.onPeerLeave(fromUserId);
      break;
    }
    case "new_peer": {
      // 作成者から「新しい参加者が来た」通知: そのピアへの Offer を作成
      await createOfferForPeer(session, msg.userId, worker);
      break;
    }
    case "offer_relay": {
      if (session.isCreator) {
        // 作成者: 宛先にそのまま転送
        const targetDc = session.dataChannels.get(msg.toUserId);
        if (targetDc?.readyState === "open") {
          targetDc.send(JSON.stringify(msg));
        }
      } else if (msg.toUserId === session.selfId) {
        // 自分宛ての Offer: Answer を作成して返送
        await handleRelayedOffer(session, msg, worker);
      }
      break;
    }
    case "answer_relay": {
      if (session.isCreator) {
        // 作成者: 宛先にそのまま転送
        const targetDc = session.dataChannels.get(msg.toUserId);
        if (targetDc?.readyState === "open") {
          targetDc.send(JSON.stringify(msg));
        }
      } else if (msg.toUserId === session.selfId) {
        // 自分宛ての Answer: PeerConnection に適用
        const pc = session.peers.get(msg.fromUserId);
        if (pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        }
      }
      break;
    }
  }
}

// 作成者が全メンバー向けの SDP Offer を生成
// 返値: userId -> { sdp, ice } のマップ
export async function createOffersForMembers(
  session: RealtimeSession,
  memberIds: string[],
): Promise<Map<string, { sdp: string; ice: string[] }>> {
  const offers = new Map<string, { sdp: string; ice: string[] }>();

  for (const memberId of memberIds) {
    const pc = createPeerConnection();
    const dc = pc.createDataChannel("data");
    session.peers.set(memberId, pc);
    session.dataChannels.set(memberId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const gathered = await waitForIceGathering(pc);

    offers.set(memberId, {
      sdp: gathered.sdp!,
      ice: [],
    });
  }

  return offers;
}

// 受信側: 作成者の Offer を使って PeerConnection を作成し、Answer を返す
export async function acceptOffer(
  session: RealtimeSession,
  creatorId: string,
  sdp: string,
  worker: WorkerLike,
): Promise<{ sdp: string; ice: string[] }> {
  const pc = createPeerConnection();
  session.peers.set(creatorId, pc);

  // Data Channel を受け取るハンドラ
  pc.ondatachannel = (event) => {
    const dc = event.channel;
    session.dataChannels.set(creatorId, dc);
    setupDataChannel(session, dc, creatorId, worker);
    dc.onopen = () => {
      // 接続確立: 公開鍵を送信
      sendKeyExchange(session, dc);
      session.callbacks.onPeerJoin(creatorId);
    };
  };

  await pc.setRemoteDescription({ type: "offer", sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const gathered = await waitForIceGathering(pc);

  return {
    sdp: gathered.sdp!,
    ice: [],
  };
}

// 作成者が受信側の Answer を処理
export async function handleAnswer(
  session: RealtimeSession,
  userId: string,
  sdp: string,
  worker: WorkerLike,
) {
  const pc = session.peers.get(userId);
  if (!pc) return;

  await pc.setRemoteDescription({ type: "answer", sdp });

  // Data Channel のセットアップ
  const dc = session.dataChannels.get(userId);
  if (dc) {
    setupDataChannel(session, dc, userId, worker);
    dc.onopen = () => {
      sendKeyExchange(session, dc);
      session.callbacks.onPeerJoin(userId);
      // 既存の参加者に新規参加者を通知
      notifyExistingPeersOfNewPeer(session, userId);
    };
  }
}

// 既存の参加者全員に新規参加者の存在を通知（作成者のみ実行）
function notifyExistingPeersOfNewPeer(
  session: RealtimeSession,
  newUserId: string,
) {
  if (!session.isCreator) return;
  for (const [peerId, dc] of session.dataChannels) {
    if (peerId === newUserId) continue;
    if (dc.readyState === "open") {
      const msg: DataChannelMessage = {
        type: "new_peer",
        userId: newUserId,
      };
      dc.send(JSON.stringify(msg));
    }
  }
}

// new_peer通知を受けた既存参加者が、新規参加者向けの Offer を作成
async function createOfferForPeer(
  session: RealtimeSession,
  targetUserId: string,
  worker: WorkerLike,
) {
  const pc = createPeerConnection();
  const dc = pc.createDataChannel("data");
  session.peers.set(targetUserId, pc);
  session.dataChannels.set(targetUserId, dc);

  setupDataChannel(session, dc, targetUserId, worker);
  dc.onopen = () => {
    sendKeyExchange(session, dc);
    session.callbacks.onPeerJoin(targetUserId);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const gathered = await waitForIceGathering(pc);

  // 作成者にリレーを依頼
  const creatorDc = session.dataChannels.get(session.creatorId);
  if (creatorDc?.readyState === "open") {
    const relayMsg: DataChannelMessage = {
      type: "offer_relay",
      fromUserId: session.selfId,
      toUserId: targetUserId,
      sdp: gathered.sdp!,
      ice: [],
    };
    creatorDc.send(JSON.stringify(relayMsg));
  }
}

// リレーされた Offer を受信し、Answer を返送
async function handleRelayedOffer(
  session: RealtimeSession,
  msg: Extract<DataChannelMessage, { type: "offer_relay" }>,
  worker: WorkerLike,
) {
  const pc = createPeerConnection();
  session.peers.set(msg.fromUserId, pc);

  pc.ondatachannel = (event) => {
    const dc = event.channel;
    session.dataChannels.set(msg.fromUserId, dc);
    setupDataChannel(session, dc, msg.fromUserId, worker);
    dc.onopen = () => {
      sendKeyExchange(session, dc);
      session.callbacks.onPeerJoin(msg.fromUserId);
    };
  };

  await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const gathered = await waitForIceGathering(pc);

  // 作成者にリレーを依頼
  const creatorDc = session.dataChannels.get(session.creatorId);
  if (creatorDc?.readyState === "open") {
    const relayMsg: DataChannelMessage = {
      type: "answer_relay",
      fromUserId: session.selfId,
      toUserId: msg.fromUserId,
      sdp: gathered.sdp!,
      ice: [],
    };
    creatorDc.send(JSON.stringify(relayMsg));
  }
}

// 公開鍵交換メッセージを送信
function sendKeyExchange(session: RealtimeSession, dc: RTCDataChannel) {
  if (dc.readyState !== "open") return;
  const msg: DataChannelMessage = {
    type: "key_exchange",
    publicKey: session.tempPublicKey,
  };
  dc.send(JSON.stringify(msg));
}

// Worker経由で暗号化
async function workerEncrypt(
  worker: WorkerLike,
  payload: string,
  privateKeys: string,
  passphrase: string,
  publicKeys: string[],
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    worker.eventWaiter("encrypt", (result) => {
      if (result.success) resolve(result.data.message);
      else reject(new Error(result.message));
    });
    worker.postMessage({
      call: "encrypt",
      passphrase,
      privateKeys,
      publicKeys,
      payload,
    });
  });
}

// Worker経由で復号
async function workerDecrypt(
  worker: WorkerLike,
  message: string,
  privateKeys: string,
  passphrase: string,
  peerPublicKeys: Map<string, string>,
): Promise<string> {
  // peerPublicKeysをknownPublicKeys形式に変換
  const knownPublicKeys: Record<string, { name: string; publicKeys: string }> =
    {};
  for (const [userId, pubKey] of peerPublicKeys) {
    knownPublicKeys[userId] = { name: userId, publicKeys: pubKey };
  }

  return new Promise<string>((resolve, reject) => {
    worker.eventWaiter("decrypt", (result) => {
      if (result.success) {
        resolve(decodeBase64Url(result.data.payload));
      } else {
        reject(new Error(result.message));
      }
    });
    worker.postMessage({
      call: "decrypt",
      passphrase,
      privateKeys,
      knownPublicKeys,
      message,
    });
  });
}

// 全参加者にメッセージを暗号化して送信
export async function sendMessage(
  session: RealtimeSession,
  text: string,
  worker: WorkerLike,
): Promise<RealtimeMessage | null> {
  if (session.peerPublicKeys.size === 0) return null;

  const allPubKeys = Array.from(session.peerPublicKeys.values());
  const payload = encodeToBase64(text);

  const encrypted = await workerEncrypt(
    worker,
    payload,
    session.tempPrivateKey,
    session.tempPassphrase,
    allPubKeys,
  );

  const dcMsg: DataChannelMessage = { type: "message", encrypted };
  const raw = JSON.stringify(dcMsg);

  for (const [, dc] of session.dataChannels) {
    if (dc.readyState === "open") {
      dc.send(raw);
    }
  }

  return {
    id: crypto.randomUUID(),
    senderId: "self",
    content: text,
    timestamp: Date.now(),
  };
}

// セッションを破棄: 全ピアに退出を通知し、接続をクローズ
export function destroy(session: RealtimeSession) {
  const leaveMsg: DataChannelMessage = { type: "leave" };
  const raw = JSON.stringify(leaveMsg);

  for (const [, dc] of session.dataChannels) {
    if (dc.readyState === "open") {
      try {
        dc.send(raw);
      } catch {
        // 送信失敗は無視
      }
    }
  }

  for (const [, pc] of session.peers) {
    pc.close();
  }

  session.peers.clear();
  session.dataChannels.clear();
  session.peerPublicKeys.clear();
}
