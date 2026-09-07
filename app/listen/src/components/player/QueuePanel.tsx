import { useMemo } from "react";
import { CRATE_ICON_SIZE, Disc3, X } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  MobileActionSheet,
  type ItemActionMenuEntry,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import type { Track } from "@/contexts/PlayerContext";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { CrateImage } from "@/components/artwork/CrateImage";
import { JamQueueLockedNotice } from "@/components/player/JamQueueLockedNotice";

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

function QueuePanelRow({
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
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const baseActions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    // In a queue context "Play now" must jump to this position, not reset the queue.
    onPlayNowOverride: onJump,
  });
  const actions = useMemo<ItemActionMenuEntry[]>(() => {
    if (locked) return [];
    if (!onRemove) return baseActions;
    return [
      ...baseActions,
      {
        type: "divider",
        key: `queue-remove-divider-${track.id}-${indexLabel}`,
      },
      {
        key: `queue-remove-${track.id}-${indexLabel}`,
        label: "Remove from queue",
        icon: X,
        danger: true,
        onSelect: onRemove,
      },
    ];
  }, [baseActions, indexLabel, locked, onRemove, track.id]);
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
      className={`group flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
        locked
          ? "cursor-not-allowed opacity-55"
          : "hover:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
      } ${faded && !locked ? "opacity-50" : ""}`}
    >
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-text-faint">
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
              Suggested
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
          imageAlt: track.album ? `${track.title} cover` : track.title,
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

export function QueuePanel({ open, onClose }: QueuePanelProps) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { isPlaying } = usePlayerState();
  const {
    queue,
    currentIndex,
    jumpTo,
    removeFromQueue,
    currentTrack,
    jamQueueLocked,
  } = usePlayerActions();

  if (!open) return null;

  const upcoming = queue.slice(currentIndex + 1);
  const played = queue
    .slice(0, currentIndex)
    .map((track, queueIndex) => ({ track, queueIndex }))
    .reverse();

  const content = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-quiet px-4 py-3">
        <h2 className="text-sm font-bold text-text-primary">
          {t("player.queue")}
        </h2>
        <button
          onClick={onClose}
          aria-label={t("player.queue.close")}
          className="flex size-10 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={CRATE_ICON_SIZE.xl} />
        </button>
      </div>

      {jamQueueLocked ? <JamQueueLockedNotice /> : null}

      {/* Now Playing */}
      {currentTrack && (
        <div className="border-b border-border-quiet px-4 py-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">
            {t("player.queue.nowPlaying")}
          </p>
          <div className="flex items-center gap-3">
            {currentTrack.albumCover ? (
              <CrateImage
                src={currentTrack.albumCover}
                alt=""
                className="size-10  rounded object-cover shrink-0"
              />
            ) : (
              <div className=" size-10 shrink-0 rounded bg-surface-control-hover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium text-accent-action">
                {currentTrack.title}
              </p>
              <p className="truncate text-xs text-text-muted">
                {currentTrack.artist}
              </p>
            </div>
            {isPlaying && (
              <div className="flex gap-0.5 items-end h-4">
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "0ms" }}
                />
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "200ms" }}
                />
                <div
                  className="equalizer-bar w-[3px] rounded-sm bg-accent-action"
                  style={{ animationDelay: "400ms" }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <div className="flex-1 overflow-y-auto">
        {upcoming.length > 0 && (
          <div className="px-4 pt-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">
              {t("player.queue.nextUp", { count: upcoming.length })}
            </p>
          </div>
        )}
        {upcoming.map((track, i) => {
          const idx = currentIndex + 1 + i;
          return (
            <QueuePanelRow
              key={`${track.id}-${idx}`}
              track={track}
              indexLabel={String(i + 1)}
              onJump={() => jumpTo(idx)}
              onRemove={jamQueueLocked ? undefined : () => removeFromQueue(idx)}
              locked={jamQueueLocked}
            />
          );
        })}

        {upcoming.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-text-faint">
            {t("player.queue.empty")}
          </div>
        )}

        {/* Previously played */}
        {played.length > 0 && (
          <>
            <div className="px-4 pt-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-text-faint">
                {t("player.queue.previous")}
              </p>
            </div>
            {played.map(({ track, queueIndex }) => (
              <QueuePanelRow
                key={`${track.id}-prev-${queueIndex}`}
                track={track}
                indexLabel={String(queueIndex + 1)}
                onJump={() => jumpTo(queueIndex)}
                faded
                locked={jamQueueLocked}
              />
            ))}
          </>
        )}
      </div>
    </>
  );

  if (!isDesktop) {
    return (
      <MobileActionSheet open={open} onClose={onClose}>
        <div className="flex max-h-[inherit] flex-col pb-3">{content}</div>
      </MobileActionSheet>
    );
  }

  return (
    <div className="listen-glass-panel listen-glass-panel--dock z-app-player-drawer fixed right-0 top-0 bottom-[72px] flex w-[360px] animate-in slide-in-from-right flex-col border-l border-border-quiet">
      {content}
    </div>
  );
}
