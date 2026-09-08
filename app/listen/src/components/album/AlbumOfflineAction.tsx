import {
  AlertCircle,
  ArrowDownToLine,
  ArrowDownToLineBold,
  CRATE_ICON_SIZE,
  Loader2,
} from "@crate/ui/icons";

import { cn } from "@/lib/utils";
import type {
  AlbumActionHandlers,
  AlbumActionState,
} from "@/components/album/album-action-types";
import { SECONDARY_ACTION_CLASS } from "@/components/album/album-action-types";

export function AlbumOfflineAction({
  state,
  actions,
  t,
}: {
  state: AlbumActionState;
  actions: AlbumActionHandlers;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (!state.canPersistAlbum) return null;

  return (
    <button
      className={cn(
        SECONDARY_ACTION_CLASS,
        state.offlineState === "ready"
          ? "text-text-accent drop-shadow-accent-action"
          : state.offlineBusy
            ? "text-accent-action"
            : state.offlineState === "error"
              ? "text-state-warning-text/90"
              : "text-text-primary/62",
      )}
      onClick={actions.onToggleOffline}
      disabled={!state.offlineSupported || state.offlineBusy}
      aria-label={
        state.offlineState === "ready"
          ? t("playlist.offline.removeCopy")
          : t("playlist.offline.makeAvailable")
      }
      title={state.offlineButtonLabel}
    >
      {state.offlineState === "ready" ? (
        <ArrowDownToLineBold size={CRATE_ICON_SIZE.lg} />
      ) : state.offlineBusy ? (
        <Loader2 size={CRATE_ICON_SIZE.lg} className="animate-spin" />
      ) : state.offlineState === "error" ? (
        <AlertCircle size={CRATE_ICON_SIZE.lg} />
      ) : (
        <ArrowDownToLine size={CRATE_ICON_SIZE.lg} />
      )}
      <span>{t("common.offline")}</span>
    </button>
  );
}
