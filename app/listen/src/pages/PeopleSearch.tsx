import type { TFunction } from "i18next";
import { Loader2, Search, UserRoundPlus } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import type { UserSearchResult } from "@/pages/people-types";

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
      className={`${className} flex items-center justify-center rounded-full bg-accent-action/15 font-semibold text-text-accent`}
    >
      {initial}
    </div>
  );
}

export function PeopleSearch({
  onQueryChange,
  query,
  results,
  searching,
  t,
}: {
  onQueryChange: (value: string) => void;
  query: string;
  results: UserSearchResult[];
  searching: boolean;
  t: TFunction;
}) {
  const trimmedQuery = query.trim();

  return (
    <section className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <div className="flex items-center gap-3 border-b border-border-quiet px-1 py-3">
        <Search size={16} className="text-text-muted" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("people.search.placeholder")}
          className="h-7 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-primary/40"
        />
      </div>

      <div className="mt-4 space-y-3">
        {trimmedQuery && searching ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={15} className="animate-spin" />
            {t("people.search.loading")}
          </div>
        ) : null}

        {!trimmedQuery ? (
          <div className="border-y border-dashed border-border-quiet px-4 py-8 text-center text-sm text-text-muted">
            {t("people.search.emptyPrompt")}
          </div>
        ) : null}

        {trimmedQuery && !searching && results.length === 0 ? (
          <div className="border-y border-dashed border-border-quiet px-4 py-8 text-center text-sm text-text-muted">
            {t("people.search.noMatches", { query: trimmedQuery })}
          </div>
        ) : null}

        {results.map((item) => {
          const label =
            item.display_name || item.username || t("people.unknownUser");
          return (
            <UserProfileLink
              key={item.id}
              username={item.username}
              hoverClassName="block"
              className="flex items-center gap-4 rounded-lg border border-border-quiet bg-text-primary/[0.02] px-4 py-3 transition-colors hover:bg-text-primary/[0.05]"
            >
              <UserAvatar name={label} avatar={item.avatar} userId={item.id} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-primary">
                  {label}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.username ? `@${item.username}` : t("people.noUsername")}
                </div>
                {item.bio ? (
                  <div className="mt-1 truncate text-xs text-text-muted">
                    {item.bio}
                  </div>
                ) : null}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-3 py-1.5 text-xs text-text-primary/65">
                <UserRoundPlus size={13} />
                {t("people.viewProfile")}
              </div>
            </UserProfileLink>
          );
        })}
      </div>
    </section>
  );
}
