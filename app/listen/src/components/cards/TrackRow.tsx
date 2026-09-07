import { memo, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { OfflineBadge } from "@crate/ui/domain/offline/OfflineBadge";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { cn, formatDuration } from "@/lib/utils";
import {
  TrackRowActions,
  TrackRowDetails,
  TrackRowLeadingControl,
  TrackRowLikeControl,
} from "@/components/cards/TrackRowParts";
import {
  useTrackRowModel,
  useTrackRowPlayback,
  type TrackRowProps,
} from "@/components/cards/TrackRowModel";

export type {
  TrackRowData,
  TrackRowProps,
} from "@/components/cards/TrackRowModel";

export const TrackRow = memo(function TrackRow({
  track,
  index,
  showArtist = false,
  showAlbum = false,
  albumCover,
  showCoverThumb = false,
  playlistOptions,
  onAddToPlaylist,
  onCreatePlaylist,
  onActionMenuOpen,
  onPlayOverride,
  selectable = false,
  selected = false,
  onSelect,
  onSelectionActionMenuOpen,
  queueTracks,
}: TrackRowProps) {
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack } = usePlayerActions();
  const { toggleTrackLike } = useLikedTracks();
  const model = useTrackRowModel({
    track,
    albumCover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayOverride,
  });
  const isActive = currentTrack?.id === model.playbackId;
  const playback = useTrackRowPlayback({
    disabled: model.disabled,
    isActive,
    isPlaying,
    onPlayOverride,
    playerTrack: model.playerTrack,
    queueTracks,
    track,
  });

  function handlePlayControlClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void playback.handleActivate();
  }

  return (
    <div
      className={cn(
        "group track-row flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
      )}
      data-active={isActive}
      data-disabled={model.disabled}
      data-selected={selected}
      aria-label={track.title}
      aria-selected={selectable ? selected : undefined}
      onContextMenu={(event) => {
        if (model.disabled) return;
        if (!model.showLocalActions) return;
        onActionMenuOpen?.();
        model.actionMenu.handleContextMenu(event);
      }}
      onClick={(event) => {
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event);
          return;
        }
        void playback.handleActivate();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (model.disabled) return;
        if (selectable && onSelect) {
          onSelect(track, event as unknown as MouseEvent<HTMLDivElement>);
          return;
        }
        void playback.handleActivate();
      }}
      role="row"
      tabIndex={model.disabled ? -1 : 0}
      onDoubleClick={
        selectable
          ? (event) => {
              event.preventDefault();
              void playback.handleActivate();
            }
          : undefined
      }
    >
      <TrackRowLeadingControl
        cover={model.cover}
        disabled={model.disabled}
        index={index}
        isActive={isActive}
        isPlaying={isPlaying}
        playControlLabel={playback.playControlLabel}
        showCoverThumb={showCoverThumb}
        trackNumber={track.track_number}
        onClick={handlePlayControlClick}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "min-w-0 truncate text-sm",
              isActive ? "font-medium text-accent-action" : "text-text-primary",
            )}
          >
            {track.title || "Unknown"}
          </div>
          {!model.isRemote ? (
            <OfflineBadge
              state={model.offlineState}
              compact
              subtle
              className="shrink-0"
            />
          ) : null}
          {model.disabled ? (
            <span className="track-row-disabled-badge shrink-0 rounded-full px-2 py-0.5 text-xs uppercase tracking-[0.14em]">
              Soon
            </span>
          ) : null}
        </div>
        <TrackRowDetails
          globalAlbumUid={track.global_album_uid}
          globalArtistUid={track.global_artist_uid}
          navigate={navigate}
          offlineLabel={model.offlineLabel}
          offlineState={model.offlineState}
          showAlbum={showAlbum}
          showArtist={showArtist}
          track={track}
        />
      </div>

      {track.duration != null && track.duration > 0 && (
        <span className="text-text-muted shrink-0 text-xs tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      <TrackRowLikeControl
        hasTrackRef={model.hasTrackRef}
        liked={model.liked}
        toggleTrackLike={toggleTrackLike}
        track={track}
      />
      <TrackRowActions
        actionMenu={model.actionMenu}
        actions={model.actions}
        cover={model.cover}
        disabled={model.disabled}
        onActionMenuOpen={onActionMenuOpen}
        onSelectionActionMenuOpen={onSelectionActionMenuOpen}
        selectable={selectable}
        selected={selected}
        showLocalActions={model.showLocalActions}
        track={track}
      />
    </div>
  );
});
