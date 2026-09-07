import { useTranslation } from "react-i18next";
import { Download, ExternalLink, Loader2 } from "@crate/ui/icons";

import { openExternalUrl } from "@/lib/external-links";
import { cn } from "@/lib/utils";
import type { BandcampItem } from "./bandcamp-model";

export function BandcampItemActions({
  item,
  busyAction,
  onImport,
  compact = false,
}: {
  item: BandcampItem;
  busyAction: string | null;
  onImport: (item: BandcampItem) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const canImport =
    item.owned === true &&
    item.downloadable === true &&
    item.latest_import_status !== "completed";

  return (
    <div className={cn("flex gap-2", compact ? "shrink-0" : "flex-wrap")}>
      {canImport ? (
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => onImport(item)}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-action px-3 text-xs font-black text-accent-action-foreground transition hover:bg-accent-action/90 disabled:opacity-50"
        >
          {busyAction === `import:${item.id}` ? (
            <Loader2 className=" size-3.5 animate-spin" />
          ) : (
            <Download className=" size-3.5" />
          )}
          {!compact ? t("common.import") : null}
        </button>
      ) : null}
      {item.item_url ? (
        <button
          type="button"
          onClick={() => void openExternalUrl(item.item_url ?? "")}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-border-quiet bg-text-primary/5 px-3 text-xs font-black text-text-primary transition hover:bg-text-primary/10"
        >
          <ExternalLink className=" size-3.5" />
          {!compact ? t("common.open") : null}
        </button>
      ) : null}
    </div>
  );
}
