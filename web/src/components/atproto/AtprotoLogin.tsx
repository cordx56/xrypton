"use client";

import { useState } from "react";
import { useAtproto } from "@/contexts/AtprotoContext";
import { useI18n } from "@/contexts/I18nContext";
import Spinner from "@/components/common/Spinner";

const AtprotoLogin = () => {
  const { login } = useAtproto();
  const { t } = useI18n();
  const [handle, setHandle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!handle.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await login(handle.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.unknown"));
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleConnect();
  };

  if (loading) return <Spinner />;

  return (
    <div className="flex flex-col items-center gap-4 p-6 max-w-sm mx-auto">
      <h2 className="text-lg font-semibold">{t("atproto.connect")}</h2>
      <input
        type="text"
        value={handle}
        onChange={(e) => setHandle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("atproto.handle_placeholder")}
        className="w-full px-4 py-2 rounded-lg bg-panel border border-accent/30 text-fg placeholder-muted focus:outline-none focus:border-accent"
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        onClick={handleConnect}
        disabled={!handle.trim()}
        className="w-full px-4 py-2 rounded-lg bg-accent text-white font-medium disabled:opacity-50 transition-opacity"
      >
        {t("atproto.connect")}
      </button>
    </div>
  );
};

export default AtprotoLogin;
