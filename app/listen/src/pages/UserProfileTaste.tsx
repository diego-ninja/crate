import { useTranslation } from "react-i18next";

import {
  badgeTone,
  formatMinutes,
  type PublicProfile,
} from "./user-profile-model";

function ProfileMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-profile-stat rounded-xl px-3 py-2">
      <div className="truncate text-lg font-black text-text-primary">
        {value}
      </div>
      <div className="mt-0.5 truncate text-xs font-bold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
    </div>
  );
}

export function ProfileTasteSummary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const stats = data.stats || {
    plays_30d: 0,
    minutes_30d: 0,
    contributions: 0,
    public_playlists: data.public_playlists.length,
  };
  const badges = data.badges || [];
  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
      <div className="user-profile-accent-panel rounded-xl p-4">
        <div className="user-profile-accent-label text-xs font-bold uppercase tracking-[0.18em]">
          {t("userProfile.topSound")}
        </div>
        <div className="mt-2 truncate text-lg font-black text-text-primary">
          {data.top_genre?.name || t("userProfile.stillMapping")}
        </div>
        <div className="mt-1 text-xs text-text-muted">
          {data.top_genre
            ? t("userProfile.topGenreStats", {
                plays: t("common.playCount", {
                  count: data.top_genre.play_count,
                }),
                duration: formatMinutes(data.top_genre.minutes_listened, t),
              })
            : t("userProfile.needsMoreSignal")}
        </div>
      </div>
      <div className="user-profile-card grid grid-cols-3 gap-2 rounded-xl p-3">
        <ProfileMiniStat
          label={t("userProfile.stats.plays30d")}
          value={String(stats.plays_30d)}
        />
        <ProfileMiniStat
          label={t("userProfile.stats.time30d")}
          value={formatMinutes(stats.minutes_30d, t)}
        />
        <ProfileMiniStat
          label={t("userProfile.stats.adds")}
          value={String(stats.contributions)}
        />
      </div>
      <ProfileBadges badges={badges} />
    </div>
  );
}

function ProfileBadges({ badges }: { badges: PublicProfile["badges"] }) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-xl p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-text-muted">
        {t("userProfile.badges.title")}
      </div>
      {badges.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {badges.map((badge) => (
            <span
              key={badge.key}
              className={
                "rounded-full border px-2.5 py-1 text-xs font-bold uppercase tracking-[0.12em] " +
                badgeTone(badge.tone)
              }
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-sm text-text-muted">
          {t("userProfile.badges.empty")}
        </div>
      )}
    </div>
  );
}
