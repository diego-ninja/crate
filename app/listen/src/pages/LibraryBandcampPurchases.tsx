import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { Download, ExternalLink, Loader2 } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";

import type { BandcampItem } from "./library-model";

export function LibraryBandcampPurchases({
  purchases,
  busyItemId,
  importedLabel,
  itemFallback,
  titleLabel,
  importLabel,
  onImport,
}: {
  purchases: BandcampItem[];
  busyItemId: number | null;
  importedLabel: string;
  itemFallback: string;
  titleLabel: string;
  importLabel: string;
  onImport: (item: BandcampItem) => void;
}) {
  return (
    <div className="grid gap-3">
      {purchases.map((item) => {
        const coverUrl = resolveMaybeApiAssetUrl(item.cover_url);
        const itemTitle =
          item.album_title ||
          item.track_title ||
          item.artist_name ||
          itemFallback;

        return (
          <article
            key={`${item.id}-${item.item_url}`}
            className="flex items-center gap-3 rounded-xl border border-text-primary/8 bg-text-primary/[0.03] p-3"
          >
            <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-text-primary/8 bg-text-primary/6">
              {coverUrl ? (
                <CrateImage
                  src={coverUrl}
                  alt=""
                  loading="lazy"
                  className=" size-full object-cover"
                />
              ) : (
                <BandcampLogo size={22} className="text-accent-action/70" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-black text-text-primary">
                {itemTitle}
              </h3>
              <p className="truncate text-xs text-text-muted">
                {item.artist_name || titleLabel}
              </p>
            </div>
            {item.latest_import_status === "completed" ? (
              <span className="rounded-full border border-state-success/25 bg-state-success/10 px-3 py-1 text-xs font-bold text-state-success">
                {importedLabel}
              </span>
            ) : item.downloadable ? (
              <button
                type="button"
                disabled={busyItemId === item.id}
                onClick={() => onImport(item)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full bg-accent-action px-3 text-xs font-black text-accent-action-foreground disabled:opacity-50"
              >
                {busyItemId === item.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                {importLabel}
              </button>
            ) : null}
            {item.item_url ? (
              <button
                type="button"
                onClick={() =>
                  window.open(
                    item.item_url || "",
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="inline-flex min-h-10 items-center rounded-full border border-border-quiet px-3 text-xs font-bold text-text-muted"
              >
                <ExternalLink size={14} />
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
