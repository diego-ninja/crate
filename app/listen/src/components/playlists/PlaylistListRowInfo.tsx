import { Sparkles } from "@crate/ui/icons";

import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import type { OfflineItemState } from "@/lib/offline";
import { cn } from "@/lib/utils";

export function PlaylistListRowInfo({
  badgeLabel,
  description,
  meta,
  name,
  offlineMeta,
  offlineState,
  trackCount,
}: {
  badgeLabel: string | null;
  description?: string;
  meta?: string;
  name: string;
  offlineMeta: string | null;
  offlineState: OfflineItemState;
  trackCount: number;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-text-primary">
          {name}
        </span>
        {badgeLabel ? (
          <span className="inline-flex items-center rounded-md border border-accent-action/30 px-1.5 py-0 text-xs font-medium text-accent-action">
            <Sparkles size={10} className="mr-0.5" />
            {badgeLabel}
          </span>
        ) : null}
        <OfflineBadge state={offlineState} compact />
      </div>
      <div className="truncate text-xs text-text-muted">
        {trackCount} track{trackCount !== 1 ? "s" : ""}
        {meta ? ` · ${meta}` : ""}
        {offlineMeta ? (
          <span
            className={cn("ml-1.5", {
              "text-text-accent/90": offlineState === "ready",
              "text-accent-action":
                offlineState === "queued" ||
                offlineState === "downloading" ||
                offlineState === "syncing",
              "text-state-warning-text/90": offlineState === "error",
            })}
          >
            · {offlineMeta}
          </span>
        ) : null}
      </div>
      {description ? (
        <div className="mt-1 truncate text-xs text-text-primary/40">
          {description}
        </div>
      ) : null}
    </div>
  );
}
