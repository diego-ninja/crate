import { useTranslation } from "react-i18next";

import { BandcampItemActions } from "./BandcampItemActions";
import { BandcampItemCover } from "./BandcampItemCover";
import { itemTitle } from "./bandcamp-model";
import type { BandcampItem } from "./bandcamp-model";

export function BandcampListItem({
  item,
  busyAction,
  onImport,
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-surface-canvas/18 p-3">
      <BandcampItemCover item={item} compact />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-black text-text-primary">
          {itemTitle(item, t("bandcamp.itemFallback"))}
        </h3>
        <p className="truncate text-xs text-text-muted">{item.artist_name}</p>
      </div>
      <BandcampItemActions
        item={item}
        busyAction={busyAction}
        onImport={onImport}
        compact
      />
    </article>
  );
}
