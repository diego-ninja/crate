import { useTranslation } from "react-i18next";

import { UserProfileHero, UserProfileMatch } from "./UserProfileHeroSections";
import { UserProfileLibrary } from "./UserProfileLibrarySections";
import { UserProfileNetwork } from "./UserProfileNetworkSections";
import type { PublicProfile } from "./user-profile-model";

export { UserProfileHero, UserProfileMatch } from "./UserProfileHeroSections";
export { UserProfileLibrary } from "./UserProfileLibrarySections";
export { UserProfileNetwork } from "./UserProfileNetworkSections";

export function UserProfileContent({
  data,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const displayName =
    data.display_name || data.username || t("people.unknownUser");
  return (
    <div className="space-y-6">
      <UserProfileHero
        data={data}
        displayName={displayName}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
        locale={locale}
      />
      <UserProfileMatch data={data} isOwnProfile={isOwnProfile} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <UserProfileLibrary data={data} />
        <UserProfileNetwork data={data} />
      </div>
    </div>
  );
}
