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

  const isVerified = level === "verified";
  const title = isVerified
    ? t("atproto.signature_verified")
    : t("atproto.signature_mismatch");

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`text-xs transition-colors ${
        isVerified
          ? "text-green-400 hover:text-green-300"
          : "text-red-400 hover:text-red-300"
      }`}
    >
      <FontAwesomeIcon
        icon={isVerified ? faCircleCheck : faTriangleExclamation}
      />
    </button>
  );
};

export default SignatureBadge;
