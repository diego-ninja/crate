import { useTranslation } from "react-i18next";

import {
  UpcomingEventRowBackground,
  UpcomingEventRowActions,
  UpcomingEventRowArtwork,
  UpcomingEventRowDetails,
} from "./UpcomingEventRowViews";
import { buildUpcomingEventRowModel } from "./upcoming-event-row-model";

import type { UpcomingItem } from "./upcoming-model";

export function UpcomingEventRow({ item }: { item: UpcomingItem }) {
  const { t, i18n } = useTranslation();
  const model = buildUpcomingEventRowModel(item, i18n.language, t);

  return (
    <article className="group relative overflow-hidden rounded-[12px] border border-accent-action/10 bg-text-primary/[0.025] p-4 text-left transition-colors hover:border-accent-action/25 hover:bg-text-primary/[0.04]">
      <UpcomingEventRowBackground coverUrl={model.coverUrl} />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UpcomingEventRowArtwork coverUrl={model.coverUrl} />
          <UpcomingEventRowDetails
            artistPath={model.artistPath}
            badgeLabel={model.badgeLabel}
            item={item}
          />
        </div>

        <UpcomingEventRowActions
          albumPath={model.albumPath}
          countdown={model.countdown}
          dateLabel={model.dateLabel}
          t={t}
        />
      </div>
    </article>
  );
}
