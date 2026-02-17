"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleCheck,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "@/contexts/I18nContext";
import type { VerificationLevel } from "@/types/atproto";

type Props = {
  level: VerificationLevel;
  onClick?: () => void;
};

const SignatureBadge = ({ level, onClick }: Props) => {
  const { t } = useI18n();

  if (level === "none") return null;

  if (level === "verified") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 text-xs text-green-400 hover:text-green-300 transition-colors"
      >
        <FontAwesomeIcon icon={faCircleCheck} />
        <span>{t("atproto.signature_verified")}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
    >
      <FontAwesomeIcon icon={faTriangleExclamation} />
      <span>{t("atproto.signature_mismatch")}</span>
    </button>
  );
};

export default SignatureBadge;
