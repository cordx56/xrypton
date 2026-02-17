"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faImage, faTimes } from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { authApiClient } from "@/api/client";
import { buildSignatureTarget } from "@/utils/canonicalize";

const MAX_CHARS = 300;

type Props = {
  onClose?: () => void;
};

const ComposePost = ({ onClose }: Props) => {
  const router = useRouter();
  const { agent } = useAtproto();
  const { signText, getSignedMessage } = useAuth();
  const { t } = useI18n();
  const { showError } = useErrorToast();

  const [text, setText] = useState("");
  const [withSignature, setWithSignature] = useState(true);
  const [posting, setPosting] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const charCount = [...text].length;
  const isOverLimit = charCount > MAX_CHARS;

  const handleImageSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      setImages((prev) => [...prev, ...files].slice(0, 4));
      // Reset input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [],
  );

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handlePost = async () => {
    if (!agent || !text.trim() || isOverLimit || posting) return;
    setPosting(true);

    try {
      // 画像アップロード
      let embed:
        | { $type: string; images: { alt: string; image: unknown }[] }
        | undefined;
      if (images.length > 0) {
        const uploadedImages = await Promise.all(
          images.map(async (file) => {
            const res = await agent.uploadBlob(file, {
              encoding: file.type,
            });
            return { alt: "", image: res.data.blob };
          }),
        );
        embed = {
          $type: "app.bsky.embed.images",
          images: uploadedImages,
        };
      }

      // ATprotoに投稿
      const response = await agent.post({
        text: text.trim(),
        langs: ["ja"],
        ...(embed ? { embed } : {}),
      } as Parameters<typeof agent.post>[0]);

      // PGP署名付きの場合
      if (withSignature) {
        try {
          const { uri, cid } = response;
          const rkey = uri.split("/").pop()!;

          // PDSからレコード完全データを取得
          const { data } = await agent.com.atproto.repo.getRecord({
            repo: agent.did!,
            collection: "app.bsky.feed.post",
            rkey,
          });

          // 署名対象を構築
          const target = buildSignatureTarget(uri, cid, data.value);

          // Worker経由でPGP署名
          const signature = await signText(target);
          if (!signature) throw new Error("Signing failed");

          // Xryptonサーバに署名保存
          const signed = await getSignedMessage();
          if (!signed) throw new Error("Auth failed");

          await authApiClient(signed.signedMessage).atproto.saveSignature({
            atproto_did: agent.did!,
            atproto_uri: uri,
            atproto_cid: cid,
            collection: "app.bsky.feed.post",
            record_json: target,
            signature,
          });
        } catch (e) {
          // 投稿は成功しているが署名保存に失敗
          showError(t("error.atproto_sign_failed"));
        }
      }

      if (onClose) {
        onClose();
      } else {
        router.push("/atproto");
      }
    } catch (e) {
      showError(
        e instanceof Error ? e.message : t("error.atproto_post_failed"),
      );
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      {/* Text area */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handlePost();
          }
        }}
        placeholder={t("atproto.compose")}
        rows={6}
        className="w-full px-4 py-3 rounded-lg bg-panel border border-accent/30 text-fg placeholder-muted resize-none focus:outline-none focus:border-accent"
      />

      {/* Character counter */}
      <div className="flex justify-end">
        <span
          className={`text-xs ${isOverLimit ? "text-red-400" : "text-muted"}`}
        >
          {charCount}/{MAX_CHARS}
        </span>
      </div>

      {/* Image preview */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {images.map((file, idx) => (
            <div key={idx} className="relative">
              <img
                src={URL.createObjectURL(file)}
                alt=""
                className="w-full h-32 object-cover rounded-lg"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-xs"
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Image attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={images.length >= 4}
            className="text-muted hover:text-accent transition-colors disabled:opacity-30"
          >
            <FontAwesomeIcon icon={faImage} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            className="hidden"
          />

          {/* PGP signature checkbox */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={withSignature}
              onChange={(e) => setWithSignature(e.target.checked)}
              className="rounded"
            />
            <span>{t("atproto.sign_post")}</span>
          </label>
        </div>

        {/* Post button */}
        <button
          onClick={handlePost}
          disabled={!text.trim() || isOverLimit || posting}
          className="px-6 py-2 rounded-full bg-accent text-white font-medium disabled:opacity-50 transition-opacity min-w-[80px]"
        >
          {posting ? (
            <div className="w-4 h-4 mx-auto border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            t("atproto.post")
          )}
        </button>
      </div>
    </div>
  );
};

export default ComposePost;
