"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPenToSquare,
  faChevronLeft,
} from "@fortawesome/free-solid-svg-icons";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useI18n } from "@/contexts/I18nContext";
import IconButton from "@/components/common/IconButton";

type Props = {
  title?: string;
  showBack?: boolean;
};

const AtprotoHeader = ({ title, showBack }: Props) => {
  const { isConnected } = useAtproto();
  const { t } = useI18n();
  const router = useRouter();

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-accent/30">
      <div className="flex items-center gap-2">
        {showBack ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="p-1 -ml-1 text-muted hover:text-fg transition-colors"
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        ) : (
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-gray-400"}`}
          />
        )}
        <h1 className="text-lg font-bold">{title ?? t("atproto.timeline")}</h1>
      </div>
      {isConnected && !showBack && (
        <Link href="/atproto/compose">
          <IconButton label={t("atproto.compose")}>
            <FontAwesomeIcon icon={faPenToSquare} />
          </IconButton>
        </Link>
      )}
    </div>
  );
};

export default AtprotoHeader;
