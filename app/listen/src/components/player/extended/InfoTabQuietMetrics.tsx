import { useTranslation } from "react-i18next";
import { Activity, Gauge } from "@crate/ui/icons";

import type { TrackInfo } from "@/lib/track-info";

export function InfoTabQuietMetrics({ info }: { info: TrackInfo }) {
  const { t } = useTranslation();
  if (info.loudness == null && info.dynamic_range == null) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {info.loudness != null ? (
        <div className="info-tab-quiet-card rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-subtle">
                {t("player.info.metric.loudness")}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {info.loudness.toFixed(1)} dB
              </p>
            </div>
            <Gauge size={18} className="text-text-muted" />
          </div>
        </div>
      ) : null}

      {info.dynamic_range != null ? (
        <div className="info-tab-quiet-card rounded-lg px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-subtle">
                {t("player.info.metric.dynamicRange")}
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {info.dynamic_range.toFixed(1)} dB
              </p>
            </div>
            <Activity size={18} className="text-text-muted" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
