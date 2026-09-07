import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { UserProfileLink } from "@/components/social/UserProfileLink";

import { UserProfileAvatar } from "./UserProfileAvatar";
import { type PublicProfile } from "./user-profile-model";

export function UserProfileNetwork({ data }: { data: PublicProfile }) {
  return (
    <section className="space-y-6">
      <UserProfilePeopleList
        titleKey="people.followers"
        emptyKey="userProfile.followers.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/followers" : null
        }
        items={data.followers_preview || []}
        itemKeyPrefix="follower"
      />
      <UserProfilePeopleList
        titleKey="people.following"
        emptyKey="userProfile.following.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/following" : null
        }
        items={data.following_preview || []}
        itemKeyPrefix="following"
      />
    </section>
  );
}

function UserProfilePeopleList({
  titleKey,
  emptyKey,
  seeAllPath,
  items,
  itemKeyPrefix,
}: {
  titleKey: "people.followers" | "people.following";
  emptyKey: "userProfile.followers.empty" | "userProfile.following.empty";
  seeAllPath: string | null;
  items: PublicProfile["followers_preview"];
  itemKeyPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {t(titleKey)}
        </h2>
        {seeAllPath ? (
          <Link
            to={seeAllPath}
            className="user-profile-accent-link text-xs hover:underline"
          >
            {t("userProfile.seeAll")}
          </Link>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {items.slice(0, 6).map((item) => {
          const label =
            item.display_name || item.username || t("people.unknownUser");
          return (
            <UserProfileLink
              key={itemKeyPrefix + "-" + item.id}
              username={item.username}
              hoverClassName="block"
              className="user-profile-item flex items-center gap-3 rounded-lg px-3 py-2.5"
            >
              <UserProfileAvatar
                name={label}
                avatar={item.avatar}
                userId={item.id}
                className=" size-10"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-primary">
                  {label}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.username
                    ? "@" + item.username
                    : t("userProfile.profile")}
                </div>
              </div>
            </UserProfileLink>
          );
        })}
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{t(emptyKey)}</p>
        ) : null}
      </div>
    </div>
  );
}
