import { Link } from "react-router";
import { BarChart3, Loader2, UserPlus, UserRoundCheck } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { UserProfileAvatar } from "./UserProfileAvatar";
import { formatJoinedDate, type PublicProfile } from "./user-profile-model";
import { ProfileRelationshipStats } from "./UserProfileRelationships";
import { ProfileTasteSummary } from "./UserProfileTaste";

export function UserProfileHero({
  data,
  displayName,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
}: {
  data: PublicProfile;
  displayName: string;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  return (
    <div className="user-profile-hero rounded-[12px] p-5 sm:p-6">
      <UserProfileHeader
        data={data}
        displayName={displayName}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
        locale={locale}
      />
      <ProfileRelationshipStats data={data} />
      <ProfileTasteSummary data={data} />
    </div>
  );
}

function UserProfileHeader({
  data,
  displayName,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
}: {
  data: PublicProfile;
  displayName: string;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const joinedDate =
    formatJoinedDate(data.joined_at, locale) ?? t("userProfile.recently");
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <UserProfileAvatar
          name={displayName}
          avatar={data.avatar}
          userId={data.id}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-3xl font-bold text-text-primary">
              {displayName}
            </h1>
            {data.relationship_state.is_friend && !isOwnProfile ? (
              <span className="user-profile-accent-badge inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium">
                {t("people.friends")}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-sm text-text-muted">
            {data.username ? "@" + data.username : t("people.noUsername")} ·{" "}
            {t("userProfile.joined", { date: joinedDate })}
          </div>
          {data.bio ? (
            <p className="user-profile-copy mt-3 max-w-2xl text-sm leading-6">
              {data.bio}
            </p>
          ) : null}
        </div>
      </div>
      <UserProfileActions
        data={data}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
      />
    </div>
  );
}

function UserProfileActions({
  data,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        to={
          isOwnProfile
            ? "/stats"
            : "/users/" + (data.username || username) + "/stats"
        }
        className="inline-flex items-center gap-2 rounded-lg border border-accent-action/25 bg-accent-action/10 px-4 py-2.5 text-sm font-semibold text-accent-action transition-colors hover:bg-accent-action/15"
      >
        <BarChart3 size={15} />
        {t("userProfile.actions.viewListeningDna")}
      </Link>
      {!isOwnProfile ? (
        <button
          type="button"
          onClick={onFollowToggle}
          disabled={busy}
          className={
            "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors " +
            (data.relationship_state.following
              ? "border border-border-quiet/15 bg-text-primary/5 text-text-primary hover:bg-text-primary/10"
              : "bg-accent-action text-accent-action-foreground hover:bg-accent-action/90")
          }
        >
          {busy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : data.relationship_state.following ? (
            <UserRoundCheck size={15} />
          ) : (
            <UserPlus size={15} />
          )}
          {data.relationship_state.following
            ? t("common.following")
            : t("common.follow")}
        </button>
      ) : (
        <Link
          to="/settings"
          className="inline-flex items-center gap-2 rounded-lg border border-border-quiet/15 bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/10"
        >
          {t("userProfile.actions.editAccount")}
        </Link>
      )}
    </div>
  );
}
