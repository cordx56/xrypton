"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/contexts/I18nContext";
import { useErrorToast } from "@/contexts/ErrorToastContext";
import { apiClient, getApiBaseUrl } from "@/api/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import Avatar from "@/components/common/Avatar";
import Spinner from "@/components/common/Spinner";

type Props = {
  userId: string;
};

const UserProfileView = ({ userId }: Props) => {
  const router = useRouter();
  const { t } = useI18n();
  const { showError } = useErrorToast();
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState("");
  const [bio, setBio] = useState("");
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const profile = await apiClient().user.getProfile(userId);
        setDisplayName(profile.display_name ?? "");
        setStatus(profile.status ?? "");
        setBio(profile.bio ?? "");
        if (profile.icon_url) {
          setIconUrl(`${getApiBaseUrl()}${profile.icon_url}`);
        }
      } catch {
        showError(t("error.unknown"));
      } finally {
        setLoading(false);
      }
    })();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/contact")}
          className="p-2 hover:bg-accent/10 rounded"
        >
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <h2 className="text-lg font-semibold">{t("tab.profile")}</h2>
      </div>

      <div className="flex flex-col items-center">
        {iconUrl ? (
          <img
            src={iconUrl}
            alt="avatar"
            className="w-20 h-20 rounded-full object-cover"
          />
        ) : (
          <Avatar name={displayName || userId} size="lg" />
        )}
        <h2 className="mt-3 text-lg font-semibold">{displayName || userId}</h2>
        <p className="text-xs text-muted/50 select-all">{userId}</p>
        {status && <p className="text-sm text-muted mt-1">{status}</p>}
      </div>

      {bio && (
        <div>
          <label className="block text-sm text-muted mb-1">
            {t("profile.bio")}
          </label>
          <p className="text-sm whitespace-pre-wrap">{bio}</p>
        </div>
      )}
    </div>
  );
};

export default UserProfileView;
