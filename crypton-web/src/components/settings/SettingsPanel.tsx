"use client";

import { useState } from "react";
import { useDialogs } from "@/contexts/DialogContext";
import { useI18n } from "@/contexts/I18nContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import Dialog from "@/components/common/Dialog";
import GenerateKey from "@/components/GenerateKey";
import Code from "@/components/Code";
import QrDisplay from "@/components/QrDisplay";
import { themeColors } from "@/types/theme";
import type { ThemeMode } from "@/types/theme";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faGear } from "@fortawesome/free-solid-svg-icons";
import type { Locale } from "@/i18n";
import { authApiClient } from "@/api/client";
import { clearAll } from "@/utils/keyStore";

const SettingsPanel = () => {
  const { pushDialog } = useDialogs();
  const { locale, setLocale, t } = useI18n();
  const { color, mode, setColor, setMode } = useTheme();
  const auth = useAuth();
  const { showError } = useErrorToast();
  const [deleting, setDeleting] = useState(false);

  const handleExportPrivateKeys = async () => {
    if (!auth.privateKeys) return;
    const reauthed = await auth.ensureRecentReauth(true);
    if (!reauthed) {
      showError(t("error.webauthn_failed"));
      return;
    }
    pushDialog((p) => (
      <Dialog {...p} title={t("profile.export_private_keys")}>
        <QrDisplay data={auth.privateKeys!} />
        <Code code={auth.privateKeys!} />
      </Dialog>
    ));
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm(t("settings.delete_account_confirm"))) return;

    try {
      setDeleting(true);

      const reauthed = await auth.ensureRecentReauth(true);
      if (!reauthed) {
        showError(t("error.webauthn_failed"));
        return;
      }

      const signed = await auth.getSignedMessage();
      if (!signed) {
        showError(t("error.delete_account_failed"));
        return;
      }

      await authApiClient(signed.signedMessage).user.deleteUser(signed.userId);
      await clearAll();
      localStorage.clear();
      window.location.href = "/";
    } catch {
      showError(t("error.delete_account_failed"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <h2 className="text-lg font-semibold">
        <FontAwesomeIcon icon={faGear} className="mr-2" />
        {t("tab.settings")}
      </h2>

      {/* Theme */}
      <section>
        <h3 className="font-medium mb-2">{t("settings.theme")}</h3>
        <div className="flex gap-2 mb-3">
          {themeColors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-full border-2 transition-all
                ${color === c ? "border-fg scale-110" : "border-transparent"}`}
              style={{ backgroundColor: `var(--color-theme-${c})` }}
              title={c}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {(["light", "dark"] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1 rounded text-sm
                ${mode === m ? "bg-accent/30 font-medium" : "hover:bg-accent/10"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      {/* Language */}
      <section>
        <h3 className="font-medium mb-2">{t("settings.language")}</h3>
        <div className="flex gap-2">
          {(["en", "ja"] as Locale[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={`px-3 py-1 rounded text-sm
                ${locale === l ? "bg-accent/30 font-medium" : "hover:bg-accent/10"}`}
            >
              {l === "en" ? "English" : "日本語"}
            </button>
          ))}
        </div>
      </section>

      {/* Account */}
      <section>
        <h3 className="font-medium mb-2">{t("settings.account")}</h3>
        <div className="mb-3 space-y-2">
          <label className="block text-sm text-muted">
            {t("settings.reauth_interval")}
          </label>
          <select
            value={String(auth.reauthPolicyDays)}
            onChange={(e) =>
              auth.setReauthPolicyDays(Number(e.target.value) as 0 | 1 | 3 | 7 | 30)
            }
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
          >
            <option value="1">1 {t("settings.days")}</option>
            <option value="3">3 {t("settings.days")}</option>
            <option value="7">7 {t("settings.days")}</option>
            <option value="30">30 {t("settings.days")}</option>
            <option value="0">{t("settings.unlimited")}</option>
          </select>
          <button
            type="button"
            onClick={async () => {
              const ok = await auth.ensureRecentReauth(true);
              if (!ok) {
                showError(t("error.webauthn_failed"));
              }
            }}
            className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm"
          >
            {auth.hasWebAuthnCredential
              ? t("settings.reauth_now")
              : t("settings.setup_webauthn")}
          </button>
        </div>
        <button
          type="button"
          onClick={() =>
            pushDialog((p) => (
              <Dialog {...p} title={t("settings.generate_keys")}>
                <GenerateKey />
              </Dialog>
            ))
          }
          className="w-full py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm"
        >
          {t("settings.generate_keys")}
        </button>
      </section>

      {/* Danger Zone */}
      <section className="border border-[var(--color-theme-dark-red)]/40 rounded-lg p-4 bg-[var(--color-theme-dark-red)]/5">
        <h3 className="font-medium mb-2 text-[var(--color-theme-dark-red)]">Danger Zone</h3>
        <div className="space-y-2">
          <button
            type="button"
            disabled={!auth.privateKeys}
            onClick={handleExportPrivateKeys}
            className="w-full py-2 rounded border border-[var(--color-theme-dark-red)]/40 hover:bg-[var(--color-theme-dark-red)]/10 text-sm disabled:opacity-50"
          >
            {t("profile.export_private_keys")}
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={handleDeleteAccount}
            className="w-full py-2 rounded bg-[var(--color-theme-dark-red)] hover:bg-[var(--color-theme-dark-red)]/80 text-white text-sm disabled:opacity-50"
          >
            {deleting
              ? t("settings.deleting_account")
              : t("settings.delete_account")}
          </button>
        </div>
      </section>
    </div>
  );
};

export default SettingsPanel;
