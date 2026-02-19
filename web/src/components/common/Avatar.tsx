"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { bytesToBase64 } from "@/utils/base64";

export type VerifyState = "verified" | "warning" | "loading";

type Props = {
  name: string;
  iconUrl?: string | null;
  iconSignature?: string | null;
  publicKey?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  onVerifyStateChange?: (state: VerifyState) => void;
};

const sizeClasses = {
  xs: "w-7 h-7 text-xs",
  sm: "w-10 h-10 text-sm",
  md: "w-10 h-10 text-sm",
  lg: "w-16 h-16 text-xl",
  xl: "w-20 h-20 text-2xl",
};

const warningBadgeSizes = {
  xs: "w-4 h-4 text-[10px]",
  sm: "w-5 h-5 text-xs",
  md: "w-5 h-5 text-xs",
  lg: "w-6 h-6 text-sm",
  xl: "w-7 h-7 text-sm",
};

const Avatar = ({
  name,
  iconUrl,
  iconSignature,
  publicKey,
  size = "md",
  onVerifyStateChange,
}: Props) => {
  const initial = name.charAt(0).toUpperCase() || "?";
  const auth = useAuth();
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<VerifyState>("warning");
  const prevUrlRef = useRef<string | null>(null);

  useEffect(() => {
    onVerifyStateChange?.(verifyState);
  }, [verifyState, onVerifyStateChange]);

  useEffect(() => {
    // 前回のblob URLをクリーンアップ
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }

    if (!iconUrl) {
      setResolvedUrl(null);
      setVerifyState("warning");
      return;
    }

    let cancelled = false;
    const worker = auth.worker;

    (async () => {
      try {
        const resp = await fetch(iconUrl);
        if (!resp.ok || cancelled) return;
        const arrayBuf = await resp.arrayBuffer();
        const rawBytes = new Uint8Array(arrayBuf);

        if (publicKey && worker && iconSignature) {
          setVerifyState("loading");
          const dataBase64 = bytesToBase64(rawBytes);

          const verified = await new Promise<boolean>((resolve) => {
            worker.eventWaiter("verify_detached_signature", (r) => {
              resolve(r.success);
            });
            worker.postMessage({
              call: "verify_detached_signature",
              publicKey,
              signature: iconSignature,
              data: dataBase64,
            });
          });

          if (cancelled) return;

          if (verified) {
            // 検証成功: 生画像バイトでblob URLを生成
            const blob = new Blob([rawBytes.buffer as ArrayBuffer]);
            const url = URL.createObjectURL(blob);
            prevUrlRef.current = url;
            setResolvedUrl(url);
            setVerifyState("verified");
          } else {
            // 検証失敗: 初期アバターにフォールバック
            setResolvedUrl(null);
            setVerifyState("warning");
          }
        } else {
          // 鍵/workerなし: 初期アバターにフォールバック
          setResolvedUrl(null);
          setVerifyState("warning");
        }
      } catch {
        if (!cancelled) {
          setResolvedUrl(null);
          setVerifyState("warning");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [iconUrl, iconSignature, publicKey, auth.worker]);

  if (resolvedUrl) {
    return (
      <div className={`${sizeClasses[size]} relative shrink-0`}>
        <img
          src={resolvedUrl}
          alt={name}
          className="w-full h-full rounded-full object-cover"
        />
        {verifyState !== "verified" && verifyState !== "loading" && (
          <div
            className={`absolute -bottom-0.5 -right-0.5 bg-yellow-500 text-white rounded-full ${warningBadgeSizes[size]} flex items-center justify-center font-bold leading-none`}
            title="Signature verification failed"
          >
            !
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-accent flex items-center justify-center font-bold text-bg shrink-0`}
    >
      {initial}
    </div>
  );
};

export default Avatar;
