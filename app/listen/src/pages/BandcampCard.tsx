import { useTranslation } from "react-i18next";

import { BandcampItemActions } from "./BandcampItemActions";
import { BandcampItemCover } from "./BandcampItemCover";
import { itemTitle } from "./bandcamp-model";
import type { BandcampItem } from "./bandcamp-model";

export function BandcampCard({
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
    <article className="group overflow-hidden rounded-[12px] border border-text-primary/8 bg-surface-canvas/18">
      <BandcampItemCover item={item} />
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-text-primary">
            {itemTitle(item, t("bandcamp.itemFallback"))}
          </h3>
          <p className="truncate text-sm text-text-muted">{item.artist_name}</p>
        </div>
        <BandcampItemActions
          item={item}
          busyAction={busyAction}
          onImport={onImport}
        />
      </div>
    </article>
  );
}
