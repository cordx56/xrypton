"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";
import type { AtprotoSignature, VerificationLevel } from "@/types/atproto";

export type AtprotoSignatureTarget = {
  uri: string;
  cid: string;
  record: unknown;
};

/**
 * 署名一括取得 + Worker経由検証のカスタムフック。
 * 投稿ターゲットのリストを受け取り、各投稿の検証状態を返す。
 */
export function useAtprotoSignatures(targets: AtprotoSignatureTarget[]): {
  verificationMap: Map<string, VerificationLevel>;
  signatureMap: Map<string, AtprotoSignature>;
  isLoading: boolean;
} {
  const { worker } = useAuth();
  const [signatureMap, setSignatureMap] = useState<
    Map<string, AtprotoSignature>
  >(new Map());
  const [verificationMap, setVerificationMap] = useState<
    Map<string, VerificationLevel>
  >(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // メモリキャッシュ: uri+cid 単位で検証結果を保持
  const cacheRef = useRef<Map<string, VerificationLevel>>(new Map());
  const runIdRef = useRef(0);

  const verify = useCallback(
    async (
      sig: AtprotoSignature,
      expectedTarget: string,
    ): Promise<VerificationLevel> => {
      if (!worker) return "none";

      return new Promise<VerificationLevel>((resolve) => {
        worker.eventWaiter("verify_extract_string", (result) => {
          if (!result.success) {
            resolve("mismatch");
            return;
          }
          // 署名から抽出された平文、DB保持値、表示中投稿の正規化結果がすべて一致する必要がある。
          const extracted = result.data.plaintext;
          if (
            extracted === sig.record_json &&
            sig.record_json === expectedTarget
          ) {
            resolve("verified");
          } else {
            resolve("mismatch");
          }
        });
        worker.postMessage({
          call: "verify_extract_string",
          publicKey: sig.signing_public_key,
          armored: sig.signature,
        });
      });
    },
    [worker],
  );

  const targetsKey = targets
    .map((t) => `${t.uri}::${t.cid}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (targets.length === 0) {
      setSignatureMap(new Map());
      setVerificationMap(new Map());
      setIsLoading(false);
      return;
    }

    const runId = ++runIdRef.current;
    setIsLoading(true);

    const cacheKeyOf = (target: AtprotoSignatureTarget) =>
      `${target.uri}::${target.cid}`;
    const targetByUri = new Map(targets.map((t) => [t.uri, t] as const));
    const uncheckedTargets = targets.filter(
      (target) => !cacheRef.current.has(cacheKeyOf(target)),
    );

    (async () => {
      try {
        const newSigMap = new Map<string, AtprotoSignature>();

        if (uncheckedTargets.length > 0) {
          // バッチ取得（最大100件ずつ）
          const uriBatches: string[][] = [];
          for (let i = 0; i < uncheckedTargets.length; i += 100) {
            uriBatches.push(
              uncheckedTargets.slice(i, i + 100).map((target) => target.uri),
            );
          }

          for (const batch of uriBatches) {
            const sigsBatch =
              await apiClient().atproto.getSignatureBatch(batch);
            if (runIdRef.current !== runId) return;

            for (const uri of batch) {
              const target = targetByUri.get(uri);
              if (!target) continue;
              const cacheKey = cacheKeyOf(target);

              const sigs = sigsBatch[uri];
              if (!sigs || sigs.length === 0) {
                cacheRef.current.set(cacheKey, "none");
                continue;
              }

              // 最新の署名を使用
              const sig = sigs[0];
              newSigMap.set(uri, sig);

              const expectedTarget = buildSignatureTarget(
                target.uri,
                target.cid,
                target.record,
              );
              const level = await verify(sig, expectedTarget);
              if (runIdRef.current !== runId) return;
              cacheRef.current.set(cacheKey, level);
            }
          }
        }

        // 現在表示中のターゲットに対応する map を構築
        const currentVerMap = new Map<string, VerificationLevel>();
        const currentSigMap = new Map<string, AtprotoSignature>();
        for (const target of targets) {
          const key = cacheKeyOf(target);
          const level = cacheRef.current.get(key) ?? "none";
          currentVerMap.set(target.uri, level);

          if (newSigMap.has(target.uri)) {
            currentSigMap.set(target.uri, newSigMap.get(target.uri)!);
          }
        }

        if (runIdRef.current !== runId) return;
        setSignatureMap(currentSigMap);
        setVerificationMap(currentVerMap);
      } catch {
        // 署名取得失敗時は未検証分を "none" とする
        for (const target of uncheckedTargets) {
          cacheRef.current.set(cacheKeyOf(target), "none");
        }

        const fallbackMap = new Map<string, VerificationLevel>();
        for (const target of targets) {
          fallbackMap.set(
            target.uri,
            cacheRef.current.get(cacheKeyOf(target)) ?? "none",
          );
        }

        if (runIdRef.current !== runId) return;
        setVerificationMap(fallbackMap);
        setSignatureMap(new Map());
      } finally {
        if (runIdRef.current !== runId) return;
        setIsLoading(false);
      }
    })();
  }, [targets, targetsKey, verify]);

  return { verificationMap, signatureMap, isLoading };
}
