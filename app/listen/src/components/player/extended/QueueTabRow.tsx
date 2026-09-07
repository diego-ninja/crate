import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Disc3, X } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/PlayerContext";

export function QueueTabRow({
  track,
  indexLabel,
  onJump,
  onRemove,
  faded = false,
  locked = false,
}: {
  track: Track;
  indexLabel: string;
  onJump: () => void;
  onRemove?: () => void;
  faded?: boolean;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const baseActions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onJump,
  });
  const actions = useMemo<ItemActionMenuEntry[]>(() => {
    if (locked) return [];
    if (!onRemove) return baseActions;
    return [
      ...baseActions,
      {
        type: "divider",
        key: `queue-tab-remove-divider-${track.id}-${indexLabel}`,
      },
      {
        key: `queue-tab-remove-${track.id}-${indexLabel}`,
        label: t("player.queue.remove"),
        icon: X,
        danger: true,
        onSelect: onRemove,
      },
    ];
  }, [baseActions, indexLabel, locked, onRemove, t, track.id]);
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role={locked ? undefined : "button"}
      tabIndex={locked ? -1 : 0}
      aria-disabled={locked}
      onClick={locked ? undefined : onJump}
      onKeyDown={(event) => {
        if (!locked && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onJump();
        }
      }}
      onContextMenu={locked ? undefined : actionMenu.handleContextMenu}
      className={`group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
        locked
          ? "cursor-not-allowed opacity-55"
          : "hover:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
      } ${faded && !locked ? "opacity-50" : ""}`}
    >
      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-text-faint">
        {indexLabel}
      </span>
      {track.albumCover ? (
        <CrateImage
          src={track.albumCover}
          alt=""
          loading="lazy"
          className={` size-8 shrink-0 rounded object-cover ${
            locked ? "grayscale" : ""
          }`}
        />
      ) : (
        <div className=" size-8 shrink-0 rounded bg-surface-control-hover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-[0.75rem] ${
              faded || locked ? "text-text-secondary" : "text-text-primary"
            }`}
          >
            {track.title}
          </p>
          {track.isSuggested ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-action">
              {t("player.queue.suggested")}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-text-muted">{track.artist}</p>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className=" size-9 shrink-0 opacity-80 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: track.albumCover,
          imageAlt: track.album
            ? t("player.queue.trackCoverAlt", { title: track.title })
            : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}
