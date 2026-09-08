import { useTranslation } from "react-i18next";
import { Calendar } from "@crate/ui/icons";

import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { UpcomingPreviewRow } from "./HomeSections";

export function HomeUpcomingPreviewPanel({
  previewItems,
  summary,
  onOpenUpcoming,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="home-upcoming-panel overflow-hidden rounded-[12px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="home-upcoming-panel-kicker flex items-center gap-2 text-xs uppercase tracking-wider">
          <Calendar size={12} />
          {t("home.radar.nextUp")}
        </div>
        <div className="home-upcoming-summary text-xs uppercase tracking-[0.16em]">
          {t("home.radar.summary", {
            shows: summary?.show_count ?? 0,
            releases: summary?.release_count ?? 0,
          })}
        </div>
      </div>
      <div className="space-y-1">
        {previewItems.slice(1).map((item) => (
          <UpcomingPreviewRow
            key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
            item={item}
            onClick={onOpenUpcoming}
          />
        ))}
      </div>
    </div>
  );
}
