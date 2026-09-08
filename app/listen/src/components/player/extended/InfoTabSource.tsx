import { useTranslation } from "react-i18next";
import { HardDrive } from "@crate/ui/icons";

import type { TrackInfo } from "@/lib/track-info";

import { SectionCard, StatCard } from "./InfoTabPrimitives";

export function InfoTabSource({
  info,
  qualityPills,
}: {
  info: TrackInfo;
  qualityPills: string[];
}) {
  const { t } = useTranslation();
  const hasSourceDetails =
    qualityPills.length > 0 ||
    info.loudness != null ||
    info.dynamic_range != null;

  return (
    <SectionCard
      title={t("player.info.sections.source.title")}
      subtitle={t("player.info.sections.source.subtitle")}
      icon={HardDrive}
    >
      <div className="grid grid-cols-2 gap-3">
        {qualityPills.map((pill) => (
          <StatCard
            key={pill}
            label={t("player.info.metric.file")}
            value={pill}
          />
        ))}
        {info.loudness != null ? (
          <StatCard
            label={t("player.info.metric.loudness")}
            value={`${info.loudness.toFixed(1)} dB`}
            helper={t("player.info.helper.integratedLevel")}
          />
        ) : null}
        {info.dynamic_range != null ? (
          <StatCard
            label={t("player.info.metric.dynamics")}
            value={`${info.dynamic_range.toFixed(1)} dB`}
            helper={t("player.info.helper.dynamicRange")}
          />
        ) : null}
      </div>
      {!hasSourceDetails ? (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.source.empty")}
        </p>
      ) : null}
    </SectionCard>
  );
}
