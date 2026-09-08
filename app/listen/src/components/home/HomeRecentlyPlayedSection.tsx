import { useTranslation } from "react-i18next";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";

import type {
  HomeDiscoveryPayload,
  HomeRecentItem,
  HomeSectionId,
} from "./home-model";
import { openRecentItemPath } from "./home-recent-entities-model";
import { RecentEntityRow } from "./HomeRecentEntityRows";

export function RecentlyPlayedSection({
  items,
  onOpenItem,
  onViewAll,
}: {
  items: HomeDiscoveryPayload["recently_played"];
  onOpenItem: (item: HomeRecentItem) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const visibleItems = isDesktop ? items : items.slice(0, 4);
  const pages = chunkItems(visibleItems, 9);
  const rail = useSectionRail(pages.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recentlyPlayed.title")}
        subtitle={t("home.sections.recentlyPlayed.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recently-played")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} className="gap-0">
        {pages.map((pageItems, pageIndex) => (
          <div
            key={`recent-page-${pageIndex}`}
            className="min-w-full snap-start"
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageItems.map((item) => (
                <RecentEntityRow
                  key={[
                    item.type,
                    openRecentItemPath(item),
                    item.played_at ?? "",
                  ].join(":")}
                  item={item}
                  onClick={() => onOpenItem(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </SectionRail>
    </section>
  );
}

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
