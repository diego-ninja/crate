import { useTranslation } from "react-i18next";

import { SectionHeader } from "./HomeSections";
import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { HomeUpcomingFeature } from "./HomeUpcomingFeatureCard";
import { HomeUpcomingPreviewPanel } from "./HomeUpcomingPreviewPanel";

function HomeUpcomingEmpty({ onOpenUpcoming }: { onOpenUpcoming: () => void }) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />
      <div className="home-upcoming-empty-card rounded-[12px] p-5">
        <h2 className="text-lg font-bold text-text-primary">
          {t("radar.empty.followTitle")}
        </h2>
        <p className="home-upcoming-empty-copy mt-1 max-w-2xl text-sm leading-6">
          {t("radar.empty.followBody")}
        </p>
      </div>
    </section>
  );
}

export function HomeUpcomingSection({
  previewItems,
  summary,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t } = useTranslation();
  const nextUpcoming = previewItems[0];

  if (!nextUpcoming) {
    return <HomeUpcomingEmpty onOpenUpcoming={onOpenUpcoming} />;
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <HomeUpcomingFeature
          item={nextUpcoming}
          onOpenUpcoming={onOpenUpcoming}
          onPlaySetlist={onPlaySetlist}
        />
        <HomeUpcomingPreviewPanel
          previewItems={previewItems}
          summary={summary}
          onOpenUpcoming={onOpenUpcoming}
        />
      </div>
    </section>
  );
}
