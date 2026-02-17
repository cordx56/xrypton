"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faTriangleExclamation,
  faChevronDown,
  faChevronUp,
} from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "@/contexts/I18nContext";
import type { AtprotoSignature, VerificationLevel } from "@/types/atproto";

type Props = {
  signature: AtprotoSignature;
  level: VerificationLevel;
  onClose: () => void;
};

const SignatureVerifier = ({ signature, level, onClose }: Props) => {
  const { t } = useI18n();
  const [showRecord, setShowRecord] = useState(false);
  const [showSignature, setShowSignature] = useState(false);

  return (
    <div className="w-full space-y-4">
      <h2 className="text-lg font-bold">{t("atproto.signature_detail")}</h2>

      {/* Status */}
      <div
        className={`flex items-center gap-2 p-3 rounded-lg ${
          level === "verified"
            ? "bg-green-500/10 text-green-400"
            : "bg-red-500/10 text-red-400"
        }`}
      >
        <FontAwesomeIcon
          icon={level === "verified" ? faCircleCheck : faTriangleExclamation}
          className="text-xl"
        />
        <span className="font-medium">
          {level === "verified"
            ? t("atproto.signature_verified")
            : t("atproto.signature_mismatch")}
        </span>
      </div>

      {/* Signer info */}
      <div className="space-y-1 text-sm">
        <p>
          <span className="text-muted">Xrypton User: </span>
          {signature.user_id}
        </p>
        <p>
          <span className="text-muted">AT Proto DID: </span>
          <span className="break-all">{signature.atproto_did}</span>
        </p>
        <p>
          <span className="text-muted">URI: </span>
          <span className="break-all">{signature.atproto_uri}</span>
        </p>
        <p>
          <span className="text-muted">CID: </span>
          <span className="break-all">{signature.atproto_cid}</span>
        </p>
        <p>
          <span className="text-muted">Signed at: </span>
          {new Date(signature.created_at).toLocaleString()}
        </p>
      </div>

      {/* Record JSON (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowRecord(!showRecord)}
          className="flex items-center gap-1 text-sm text-muted hover:text-fg transition-colors"
        >
          <FontAwesomeIcon icon={showRecord ? faChevronUp : faChevronDown} />
          <span>Signature Target Data</span>
        </button>
        {showRecord && (
          <pre className="mt-2 p-3 rounded-lg bg-panel text-xs overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
            {signature.record_json}
          </pre>
        )}
      </div>

      {/* PGP Signature (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowSignature(!showSignature)}
          className="flex items-center gap-1 text-sm text-muted hover:text-fg transition-colors"
        >
          <FontAwesomeIcon icon={showSignature ? faChevronUp : faChevronDown} />
          <span>PGP Signature</span>
        </button>
        {showSignature && (
          <pre className="mt-2 p-3 rounded-lg bg-panel text-xs overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
            {signature.signature}
          </pre>
        )}
      </div>

      {/* Public key fingerprint */}
      <div className="text-xs text-muted">
        <p>Public Key:</p>
        <pre className="mt-1 p-2 rounded bg-panel overflow-x-auto whitespace-pre-wrap break-all">
          {signature.signing_public_key.slice(0, 100)}...
        </pre>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full py-2 rounded-lg bg-accent/20 text-fg hover:bg-accent/30 transition-colors"
      >
        {t("common.close")}
      </button>
    </div>
  );
};

export default SignatureVerifier;
