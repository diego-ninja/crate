import { useTranslation } from "react-i18next";
import { Activity } from "@crate/ui/icons";

import type { TrackInfo } from "@/lib/track-info";

import { MetricBar, SectionCard } from "./InfoTabPrimitives";

export function InfoTabBliss({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("player.info.sections.bliss.title")}
      subtitle={
        info.bliss_signature
          ? t("player.info.sections.bliss.subtitle")
          : t("player.info.sections.bliss.emptySubtitle")
      }
      icon={Activity}
    >
      {info.bliss_signature ? (
        <>
          <MetricBar
            label={t("player.info.metric.texture")}
            value={info.bliss_signature.texture}
          />
          <MetricBar
            label={t("player.info.metric.motion")}
            value={info.bliss_signature.motion}
            tone="accent"
          />
          <MetricBar
            label={t("player.info.metric.density")}
            value={info.bliss_signature.density}
            tone="warm"
          />
        </>
      ) : (
        <p className="text-sm text-text-muted">
          {t("player.info.sections.bliss.empty")}
        </p>
      )}
    </SectionCard>
  );
}
