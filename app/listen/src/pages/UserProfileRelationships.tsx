import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import {
  affinityBandLabel,
  affinityTone,
  type PublicProfile,
} from "./user-profile-model";

export function ProfileRelationshipStats({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-4">
      <RelationshipStat
        label={t("people.followers")}
        value={data.followers_count}
        to={
          data.username ? "/users/" + data.username + "/followers" : "/people"
        }
      />
      <RelationshipStat
        label={t("people.following")}
        value={data.following_count}
        to={
          data.username ? "/users/" + data.username + "/following" : "/people"
        }
      />
      <RelationshipStat
        label={t("people.friends")}
        value={data.friends_count}
      />
      <div
        className={"rounded-xl border p-4 " + affinityTone(data.affinity_band)}
      >
        <div className="text-xs uppercase tracking-wide opacity-75">
          {t("userProfile.affinity")}
        </div>
        <div className="mt-2 text-2xl font-semibold">
          {data.affinity_score}%
        </div>
        <div className="mt-1 text-xs capitalize opacity-75">
          {affinityBandLabel(data.affinity_band, t)}
        </div>
      </div>
    </div>
  );
}

function RelationshipStat({
  label,
  value,
  to,
}: {
  label: string;
  value: number;
  to?: string;
}) {
  return (
    <div className="user-profile-card rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {to ? (
        <Link
          to={to}
          className="mt-2 block text-2xl font-semibold text-text-primary transition-colors hover:text-accent-action"
        >
          {value}
        </Link>
      ) : (
        <div className="mt-2 text-2xl font-semibold text-text-primary">
          {value}
        </div>
      )}
    </div>
  );
}
