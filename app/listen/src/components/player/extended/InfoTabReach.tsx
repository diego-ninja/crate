import { useTranslation } from "react-i18next";
import { Users } from "@crate/ui/icons";

import type { TrackInfo } from "@/lib/track-info";
import { formatCompact } from "@/lib/utils";

import { SectionCard, StatCard } from "./InfoTabPrimitives";

export function InfoTabReach({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  const hasReach = Boolean(
    info.lastfm_listeners || info.lastfm_playcount || info.popularity,
  );

  return (
    <SectionCard
      title={t("player.info.sections.reach.title")}
      subtitle={t("player.info.sections.reach.subtitle")}
      icon={Users}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {info.lastfm_listeners != null && info.lastfm_listeners > 0 ? (
          <StatCard
            label={t("player.info.metric.listeners")}
            value={formatCompact(info.lastfm_listeners)}
            helper={t("player.info.helper.lastfmAudience")}
          />
        ) : null}
        {info.lastfm_playcount != null && info.lastfm_playcount > 0 ? (
          <StatCard
            label={t("player.info.metric.plays")}
            value={formatCompact(info.lastfm_playcount)}
            helper={t("player.info.helper.lastfmScrobbles")}
          />
        ) : null}
        {info.popularity != null && info.popularity > 0 ? (
          <StatCard
            label={t("player.info.metric.popularity")}
            value={`${Math.round(info.popularity)}%`}
            helper={t("player.info.helper.normalizedScore")}
          />
        ) : null}
      </div>
      {!hasReach ? (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.reach.empty")}
        </p>
      ) : null}
    </SectionCard>
  );
}
