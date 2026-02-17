"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faXmark } from "@fortawesome/free-solid-svg-icons";

type Props = {
  src: string;
  alt: string;
  onClose: () => void;
  onDownload?: () => void;
};

/** 画像拡大表示のライトボックス */
const ImageLightbox = ({ src, alt, onClose, onDownload }: Props) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex gap-2">
        {onDownload && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
            className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
            title="Download"
          >
            <FontAwesomeIcon icon={faDownload} className="text-lg" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white"
        >
          <FontAwesomeIcon icon={faXmark} className="text-lg" />
        </button>
      </div>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
};

export default ImageLightbox;
