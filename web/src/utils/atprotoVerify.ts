import { Agent, AtUri } from "@atproto/api";
import { apiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";
import type { WorkerEventWaiter } from "@/hooks/useWorker";
import type { WorkerCallMessage } from "@/utils/schema";
import type { z } from "zod";

export type WorkerBridge = {
  eventWaiter: WorkerEventWaiter;
  postMessage: (msg: z.infer<typeof WorkerCallMessage>) => void;
};

/**
 * 公開鍵投稿をフロントエンドで検証する（ATProto未ログインでも動作）。
 *
 * 1. ATProtoライブラリでPDSから投稿を取得
 * 2. Xryptonサーバから署名と公開鍵を取得
 * 3. PGP署名をWorkerで検証
 * 4. 投稿テキスト中のfingerprintがサーバの主鍵fingerprintと一致するか確認
 */
export async function verifyPubkeyPostOnPds(
  pubkeyPostUri: string,
  pdsUrl: string,
  userId: string,
  worker: WorkerBridge,
): Promise<boolean> {
  try {
    // 1. AT URIをパースしPDSから投稿レコードを取得
    const atUri = new AtUri(pubkeyPostUri);
    const pdsAgent = new Agent(new URL(pdsUrl));
    const record = await pdsAgent.com.atproto.repo.getRecord({
      repo: atUri.hostname,
      collection: atUri.collection,
      rkey: atUri.rkey,
    });

    // 2. Xryptonサーバからこの投稿の署名を取得
    const sigs = await apiClient().atproto.getSignature(
      pubkeyPostUri,
      undefined,
      { fresh: true },
    );
    if (sigs.length === 0) return false;
    const sig = sigs[0];

    // 3. Xryptonサーバから公開鍵情報を取得
    const keys = await apiClient().user.getKeys(userId, { fresh: true });
    const signingPublicKey: string = keys.signing_public_key;
    const primaryFingerprint: string = keys.primary_key_fingerprint;

    // 4. 署名対象の正規化JSONを構築し、PGP署名を検証
    const cid = record.data.cid ? String(record.data.cid) : sig.atproto_cid;
    const expectedTarget = buildSignatureTarget(
      pubkeyPostUri,
      cid,
      record.data.value,
    );
    const verified = await new Promise<boolean>((resolve) => {
      worker.eventWaiter("verify_extract_string", (result) => {
        if (!result.success) {
          resolve(false);
          return;
        }
        resolve(
          result.data.plaintext === sig.record_json &&
            sig.record_json === expectedTarget,
        );
      });
      worker.postMessage({
        call: "verify_extract_string",
        publicKey: signingPublicKey,
        armored: sig.signature,
      });
    });
    if (!verified) return false;

    // 5. 投稿テキストからfingerprintを抽出し、主鍵fingerprintの末尾と照合
    const text: string | undefined = (record.data.value as { text?: string })
      ?.text;
    if (!text) return false;
    const fpMatch = text.match(
      /([0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4}\s[0-9A-Fa-f]{4})/,
    );
    if (!fpMatch) return false;
    const extractedFp = fpMatch[1].replace(/\s/g, "").toUpperCase();
    const expectedFpTail = primaryFingerprint.slice(-16).toUpperCase();

    return extractedFp === expectedFpTail;
  } catch {
    return false;
  }
}
