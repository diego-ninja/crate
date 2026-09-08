import type { TFunction } from "i18next";
import { Link } from "react-router";

import type { AuthUser } from "@/contexts/auth-context";
import type { SocialSummary } from "@/pages/people-types";

export function PeopleSummary({
  data,
  t,
  user,
}: {
  data: SocialSummary | null | undefined;
  t: TFunction;
  user: AuthUser | null;
}) {
  const username = user?.username;
  const ownProfileHref = username ? `/users/${username}` : "/settings";
  const ownFollowersHref = username
    ? `/users/${username}/followers`
    : "/people";
  const ownFollowingHref = username
    ? `/users/${username}/following`
    : "/people";

  return (
    <div className="rounded-[12px] border border-border-quiet bg-text-primary/5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">
            {t("people.title")}
          </h1>
          <p className="mt-1 text-sm text-text-muted">{t("people.subtitle")}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Link
          to={ownProfileHref}
          className="rounded-xl border border-accent-action/15 bg-accent-action/5 p-4 transition-colors hover:bg-accent-action/10"
        >
          <div className="text-xs uppercase tracking-wide text-text-accent/70">
            {t("people.summary.yourProfile")}
          </div>
          <div className="mt-2 text-lg font-semibold text-text-primary">
            {data?.profile.display_name ||
              user?.name ||
              user?.email ||
              t("people.fallback.you")}
          </div>
          <div className="mt-1 text-sm text-text-muted">
            {data?.profile.username
              ? `@${data.profile.username}`
              : t("people.summary.setUsername")}
          </div>
        </Link>
        <Link
          to={ownFollowersHref}
          className="rounded-xl border border-border-quiet bg-text-primary/[0.03] p-4 transition-colors hover:bg-text-primary/[0.05]"
        >
          <div className="text-xs uppercase tracking-wide text-text-muted">
            {t("people.followers")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {data?.followers_count ?? "—"}
          </div>
        </Link>
        <Link
          to={ownFollowingHref}
          className="rounded-xl border border-border-quiet bg-text-primary/[0.03] p-4 transition-colors hover:bg-text-primary/[0.05]"
        >
          <div className="text-xs uppercase tracking-wide text-text-muted">
            {t("people.following")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {data?.following_count ?? "—"}
          </div>
        </Link>
        <div className="border-t border-border-quiet p-4">
          <div className="text-xs uppercase tracking-wide text-text-muted">
            {t("people.friends")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {data?.friends_count ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
