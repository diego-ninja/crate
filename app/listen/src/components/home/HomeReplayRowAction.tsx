import { useMemo } from "react";
import { Disc3, Play } from "@crate/ui/icons";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { TrackCoverThumb } from "@/components/artwork/TrackCoverThumb";
import { albumCoverApiUrl } from "@/lib/library-routes";

import type { ReplayTrack } from "./home-model";

function replayCoverUrl(item: ReplayTrack): string | undefined {
  if (item.album_id == null && !item.global_album_uid) return undefined;
  return albumCoverApiUrl(
    {
      albumId: item.album_id,
      globalAlbumUid: item.global_album_uid,
      albumEntityUid: item.album_entity_uid ?? undefined,
      artistEntityUid: item.artist_entity_uid ?? undefined,
      albumSlug: item.album_slug ?? undefined,
      artistName: item.artist,
      albumName: item.album,
    },
    { size: 256 },
  );
}

export function HomeReplayRowAction({
  item,
  onPlay,
}: {
  item: ReplayTrack;
  onPlay: () => void;
}) {
  const cover = replayCoverUrl(item);
  const menuTrack = useMemo(
    () => ({
      id: item.track_id ?? item.track_path ?? item.title,
      global_track_uid: item.global_track_uid ?? undefined,
      title: item.title,
      artist: item.artist,
      artist_id: item.artist_id ?? undefined,
      global_artist_uid: item.global_artist_uid ?? undefined,
      artist_slug: item.artist_slug ?? undefined,
      album: item.album,
      album_id: item.album_id ?? undefined,
      global_album_uid: item.global_album_uid ?? undefined,
      album_slug: item.album_slug ?? undefined,
      path: item.track_path ?? undefined,
      library_track_id: item.track_id ?? undefined,
    }),
    [item],
  );
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: cover,
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
      className="home-playback-row group/row flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors"
    >
      <div className="relative size-11 shrink-0">
        <TrackCoverThumb
          src={cover}
          iconSize={16}
          className="absolute inset-0 rounded-xl"
        />
        <div className="home-playback-cover-overlay absolute inset-0 flex items-center justify-center rounded-xl">
          <Play
            size={15}
            fill="currentColor"
            className="home-playback-cover-play-icon"
          />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text-primary">
          {item.title}
        </div>
        <div className="truncate text-xs text-text-muted">{item.artist}</div>
      </div>
      <span className="home-replay-count-badge shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider">
        {item.play_count}×
      </span>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className=" size-8 opacity-80 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.title,
          subtitle: item.artist,
          detail: item.album,
          imageUrl: cover,
          imageAlt: item.album ? `${item.title} cover` : item.title,
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
