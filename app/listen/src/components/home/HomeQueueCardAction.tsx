import { useMemo } from "react";
import { Disc3, Play } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import type { Track } from "@/contexts/PlayerContext";

export function HomeQueueCardAction({
  track,
  onPlay,
}: {
  track: Track;
  onPlay: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onPlay,
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="home-queue-card group w-[220px] shrink-0 cursor-pointer overflow-hidden rounded-xl text-left"
    >
      <div className="flex items-center gap-3 p-3">
        <div className="relative size-16 shrink-0">
          <TrackCoverThumb
            src={track.albumCover}
            iconSize={18}
            className="absolute inset-0 rounded-xl"
          />
          <div className="home-playback-cover-overlay absolute inset-0 flex items-center justify-center rounded-xl">
            <Play
              size={18}
              fill="currentColor"
              className="home-playback-cover-play-icon"
            />
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text-primary">
            {track.title}
          </div>
          <div className="mt-1 truncate text-xs text-text-muted">
            {track.artist}
          </div>
          {track.album ? (
            <div className="home-playback-album-text mt-1 truncate text-xs">
              {track.album}
            </div>
          ) : null}
        </div>
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className=" size-8 self-start opacity-80 transition-opacity hover:opacity-100"
        />
      </div>
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
