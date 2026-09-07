import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Loader2, UserPlus, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { CrateImage } from "@/components/artwork/CrateImage";

interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

function UserAvatar({
  name,
  avatar,
  userId,
  className = " size-11",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  className?: string;
}) {
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt={name}
        onError={handleAvatarError}
        className={`${className} rounded-full object-cover`}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div
      className={`${className} rounded-full bg-accent-action/15 text-text-accent flex items-center justify-center font-semibold`}
    >
      {initial}
    </div>
  );
}

export function UserConnections() {
  const { t } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const location = useLocation();
  const mode = location.pathname.endsWith("/following")
    ? "following"
    : "followers";
  const title =
    mode === "following" ? t("people.following") : t("people.followers");
  const { data, loading } = useApi<UserListItem[]>(
    username
      ? `/api/users/${encodeURIComponent(username)}/${mode}?limit=200`
      : null,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-border-quiet bg-text-primary/5 p-5 sm:p-6">
        <Link
          to={username ? `/users/${username}` : "/people"}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} />
          {t("userConnections.backToProfile")}
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <Users size={18} className="text-text-accent" />
          <div>
            <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
            <p className="mt-1 text-sm text-text-muted">
              {t("userConnections.subtitle", { username })}
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-text-muted">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-3">
            {data.map((item) => {
              const label =
                item.display_name || item.username || t("people.unknownUser");
              return (
                <UserProfileLink
                  key={`${mode}-${item.id}`}
                  username={item.username}
                  hoverClassName="block"
                  className="flex items-center gap-4 rounded-lg border border-border-quiet bg-text-primary/[0.02] px-4 py-3 hover:bg-text-primary/[0.05] transition-colors"
                >
                  <UserAvatar
                    name={label}
                    avatar={item.avatar}
                    userId={item.id}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {label}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      {item.username
                        ? `@${item.username}`
                        : t("people.noUsername")}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-3 py-1.5 text-xs text-text-primary/65">
                    <UserPlus size={13} />
                    {t("people.viewProfile")}
                  </div>
                </UserProfileLink>
              );
            })}
          </div>
        ) : (
          <div className="border-y border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-muted">
            {mode === "following"
              ? t("userConnections.empty.following")
              : t("userConnections.empty.followers")}
          </div>
        )}
      </section>
    </div>
  );
}
