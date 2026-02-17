"use client";

import { useI18n } from "@/contexts/I18nContext";

type Props = {
  status: "success" | "error" | "already_linked";
  message?: string;
};

const AtprotoAccountLink = ({ status, message }: Props) => {
  const { t } = useI18n();

  if (status === "success") {
    return (
      <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
        {t("atproto.link_account")}
      </div>
    );
  }

  if (status === "already_linked") {
    return (
      <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
        {t("error.atproto_did_already_linked")}
      </div>
    );
  }

  return (
    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
      {message ?? t("error.atproto_auth_failed")}
    </div>
  );
};

export default AtprotoAccountLink;
