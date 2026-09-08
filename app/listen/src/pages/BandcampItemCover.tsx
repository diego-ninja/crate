import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";
import { itemTitle } from "./bandcamp-model";
import type { BandcampItem } from "./bandcamp-model";

export function BandcampItemCover({
  item,
  compact = false,
}: {
  item: BandcampItem;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const title = itemTitle(item, t("bandcamp.itemFallback"));

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden bg-text-primary/6",
        compact
          ? "h-14 w-14 rounded-xl border border-text-primary/8"
          : "aspect-square w-full",
      )}
    >
      {item.cover_url ? (
        <CrateImage
          src={item.cover_url}
          retryPolicy="none"
          alt=""
          loading="lazy"
          className=" size-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <span className="text-xl font-black text-text-muted/70">
          {title.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}
