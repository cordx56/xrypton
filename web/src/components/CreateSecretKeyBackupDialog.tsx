"use client";

import { useState } from "react";
import Dialog from "@/components/common/Dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { useI18n } from "@/contexts/I18nContext";
import { saveSecretKeyBackup } from "@/utils/secretKeyBackup";
import { buildAuthPayload } from "@/utils/authPayload";
import { allPassphrasesMeetMinLength } from "@/utils/passphraseValidation";

type Props = {
  close: () => void;
  closeWithoutHistory: () => void;
  setOnClose: (close: () => void) => void;
  keys: string;
  userId: string;
  onSaved?: (subPassphrase: string) => void;
};

const CreateSecretKeyBackupDialog = ({
  close,
  closeWithoutHistory,
  setOnClose,
  keys,
  userId,
  onSaved,
}: Props) => {
  const auth = useAuth();
  const { showError, showSuccess } = useErrorToast();
  const { t } = useI18n();
  const [mainPassphrase, setMainPassphrase] = useState("");
  const [subPassphrase, setSubPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!allPassphrasesMeetMinLength(mainPassphrase, subPassphrase)) {
      showError(t("error.min_length"));
      return;
    }
    if (!auth.worker) {
      showError(t("error.unknown"));
      return;
    }

    setSubmitting(true);
    try {
      const validated = await new Promise<boolean>((resolve) => {
        auth.worker!.eventWaiter("validate_passphrases", (data) => {
          resolve(data.success);
        });
        auth.worker!.postMessage({
          call: "validate_passphrases",
          privateKeys: keys,
          mainPassphrase,
          subPassphrase,
        });
      });
      if (!validated) {
        showError(t("error.passphrase_validation_failed"));
        return;
      }

      const signedMessage = await new Promise<string | null>((resolve) => {
        auth.worker!.eventWaiter("sign", (result) => {
          resolve(result.success ? result.data.signed_message : null);
        });
        auth.worker!.postMessage({
          call: "sign",
          keys,
          passphrase: subPassphrase,
          payload: buildAuthPayload(),
        });
      });

      if (!signedMessage) {
        showError(t("error.unauthorized"));
        return;
      }

      await saveSecretKeyBackup({
        worker: auth.worker!,
        signed: {
          signedMessage,
          userId,
        },
        secretKey: keys,
        subpassphrase: subPassphrase,
        mainPassphrase,
      });

      onSaved?.(subPassphrase);
      showSuccess(t("settings.backup_created"));
      close();
    } catch {
      showError(t("error.backup_create_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      close={close}
      closeWithoutHistory={closeWithoutHistory}
      setOnClose={setOnClose}
      title={t("settings.create_secret_key_backup")}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {t("settings.create_secret_key_backup_desc")}
        </p>
        <div className="space-y-2">
          <label className="block text-sm">{t("auth.main_passphrase")}</label>
          <input
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
            type="password"
            value={mainPassphrase}
            onChange={(e) => setMainPassphrase(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm">{t("auth.sub_passphrase")}</label>
          <input
            className="w-full border border-accent/30 rounded px-3 py-2 bg-transparent"
            type="password"
            value={subPassphrase}
            onChange={(e) => setSubPassphrase(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded border border-accent/30 hover:bg-accent/10 text-sm"
            onClick={close}
            disabled={submitting}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded bg-accent/30 hover:bg-accent/50 text-sm disabled:opacity-50"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? t("settings.creating_backup") : t("common.ok")}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default CreateSecretKeyBackupDialog;
