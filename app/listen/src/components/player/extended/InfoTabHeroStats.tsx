import { useTranslation } from "react-i18next";

import type { TrackInfo } from "@/lib/track-info";

import { StatCard } from "./InfoTabPrimitives";
import { formatKey } from "./info-tab-data";

export function InfoTabHeroStats({
  info,
  qualityPills,
}: {
  info: TrackInfo;
  qualityPills: string[];
}) {
  const { t } = useTranslation();
  const musicalKey = formatKey(info.audio_key, info.audio_scale);

  return (
    <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {info.bpm ? (
        <StatCard
          label={t("player.info.metric.tempo")}
          value={String(Math.round(info.bpm))}
          helper="BPM"
        />
      ) : null}
      {musicalKey ? (
        <StatCard
          label={t("player.info.metric.key")}
          value={musicalKey}
          helper={t("player.info.helper.harmonicCenter")}
        />
      ) : null}
      {info.popularity != null && info.popularity > 0 ? (
        <StatCard
          label={t("player.info.metric.popularity")}
          value={`${Math.round(info.popularity)}%`}
          helper={t("player.info.helper.crateScore")}
        />
      ) : null}
      {qualityPills.length > 0 ? (
        <StatCard
          label={t("player.info.metric.source")}
          value={qualityPills[0]!}
          helper={
            qualityPills.slice(1).join(" · ") ||
            t("player.info.helper.libraryFile")
          }
        />
      ) : null}
    </div>
  );
}
