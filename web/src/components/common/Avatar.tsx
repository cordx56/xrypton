"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { bytesToBase64 } from "@/utils/base64";

export type VerifyState = "verified" | "warning" | "loading";

type CachedVerifyResult =
  | { status: "verified"; resolvedUrl: string }
  | { status: "warning" };

type CachedVerifyEntry =
  | { status: "loading"; promise: Promise<CachedVerifyResult> }
  | CachedVerifyResult;

const ICON_VERIFY_CACHE_MAX = 200;
const iconVerifyCache = new Map<string, CachedVerifyEntry>();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const view = new Uint8Array(new ArrayBuffer(bytes.length));
  view.set(bytes);
  return view.buffer;
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

const setIconVerifyCache = (key: string, entry: CachedVerifyEntry): void => {
  if (iconVerifyCache.has(key)) {
    const previous = iconVerifyCache.get(key);
    if (
      previous?.status === "verified" &&
      previous.resolvedUrl !==
        (entry.status === "verified" ? entry.resolvedUrl : "")
    ) {
      URL.revokeObjectURL(previous.resolvedUrl);
    }
    iconVerifyCache.delete(key);
  }

  iconVerifyCache.set(key, entry);

  while (iconVerifyCache.size > ICON_VERIFY_CACHE_MAX) {
    const oldestKey = iconVerifyCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = iconVerifyCache.get(oldestKey);
    if (oldest?.status === "verified") {
      URL.revokeObjectURL(oldest.resolvedUrl);
    }
    iconVerifyCache.delete(oldestKey);
  }
};

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

  useEffect(() => {
    onVerifyStateChange?.(verifyState);
  }, [verifyState, onVerifyStateChange]);

  useEffect(() => {
    let cancelled = false;

    if (!iconUrl) {
      queueMicrotask(() => {
        if (cancelled) return;
        setResolvedUrl(null);
        setVerifyState("warning");
      });
      return () => {
        cancelled = true;
      };
    }

    const worker = auth.worker;
    let cacheKey: string | null = null;

    (async () => {
      try {
        if (!publicKey || !worker || !iconSignature) {
          setResolvedUrl(null);
          setVerifyState("warning");
          return;
        }

        const resp = await fetch(iconUrl);
        if (!resp.ok) {
          setResolvedUrl(null);
          setVerifyState("warning");
          return;
        }

        const arrayBuf = await resp.arrayBuffer();
        const rawBytes = new Uint8Array(arrayBuf);
        const dataHash = await sha256Hex(rawBytes);
        const dataBase64 = bytesToBase64(rawBytes);

        cacheKey = `${publicKey}:${iconSignature}:${dataHash}`;
        const cached = iconVerifyCache.get(cacheKey);

        if (cached?.status === "verified") {
          if (!cancelled) {
            setResolvedUrl(cached.resolvedUrl);
            setVerifyState("verified");
          }
          return;
        }

        if (cached?.status === "warning") {
          if (!cancelled) {
            setResolvedUrl(null);
            setVerifyState("warning");
          }
          return;
        }

        setVerifyState("loading");

        const verifyPromise =
          cached?.status === "loading"
            ? cached.promise
            : (async (): Promise<CachedVerifyResult> => {
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

                if (!verified) {
                  return { status: "warning" };
                }

                const blob = new Blob([toArrayBuffer(rawBytes)]);
                return {
                  status: "verified",
                  resolvedUrl: URL.createObjectURL(blob),
                };
              })();

        if (!cached || cached.status !== "loading") {
          setIconVerifyCache(cacheKey, {
            status: "loading",
            promise: verifyPromise,
          });
        }

        const result = await verifyPromise;
        setIconVerifyCache(cacheKey, result);

        if (cancelled) return;

        if (result.status === "verified") {
          setResolvedUrl(result.resolvedUrl);
          setVerifyState("verified");
        } else {
          setResolvedUrl(null);
          setVerifyState("warning");
        }
      } catch {
        if (cacheKey && iconVerifyCache.get(cacheKey)?.status === "loading") {
          iconVerifyCache.delete(cacheKey);
        }
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
