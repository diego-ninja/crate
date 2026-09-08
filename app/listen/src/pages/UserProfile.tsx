import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { api } from "@/lib/api";

import { UserProfileContent } from "./UserProfileSections";
import type { PublicProfile } from "./user-profile-model";

export function UserProfile() {
  const { t, i18n } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const { data, loading, refetch } = useApi<PublicProfile>(
    username ? "/api/users/" + encodeURIComponent(username) + "/page" : null,
  );
  const [busy, setBusy] = useState(false);
  const isOwnProfile = Boolean(data && user?.id === data.id);

  async function handleFollowToggle() {
    if (!data || isOwnProfile) return;
    setBusy(true);
    try {
      if (data.relationship_state.following) {
        await api("/api/users/" + data.id + "/follow", "DELETE");
        toast.success(
          t("userProfile.toasts.unfollowed", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      } else {
        await api("/api/users/" + data.id + "/follow", "POST");
        toast.success(
          t("userProfile.toasts.following", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      }
      refetch();
    } catch {
      toast.error(t("userProfile.toasts.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <CrateLoader label={t("userProfile.loadingLabel")} />;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-text-primary">
          {t("userProfile.notFound")}
        </p>
        <Link
          to="/people"
          className="inline-flex items-center gap-2 text-sm text-accent-action hover:underline"
        >
          <ArrowLeft size={14} />
          {t("userProfile.backToPeople")}
        </Link>
      </div>
    );
  }

  return (
    <UserProfileContent
      data={data}
      isOwnProfile={isOwnProfile}
      username={username}
      busy={busy}
      onFollowToggle={handleFollowToggle}
      locale={i18n.language}
    />
  );
}
