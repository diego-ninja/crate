import { useTranslation } from "react-i18next";

import { Users } from "@crate/ui/icons";

import type { PublicProfile } from "./user-profile-model";

export function UserProfileMatch({
  data,
  isOwnProfile,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Users size={16} className="user-profile-accent-icon" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.match.title")}
        </h2>
      </div>
      {isOwnProfile ? (
        <p className="mt-3 text-sm text-text-muted">
          {t("userProfile.match.ownProfile")}
        </p>
      ) : data.affinity_reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.affinity_reasons.map((reason) => (
            <span
              key={reason}
              className="user-profile-reason rounded-full px-3 py-1.5 text-xs"
            >
              {reason}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-muted">
          {t("userProfile.match.notEnough")}
        </p>
      )}
    </section>
  );
}
