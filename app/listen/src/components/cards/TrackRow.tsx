import { memo } from "react";
import { useNavigate } from "react-router";
import { Play, Pause, Heart } from "lucide-react";
import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { buildTrackMenuPlayerTrack } from "@/components/actions/shared";
import { OfflineBadge } from "@/components/offline/OfflineBadge";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerState, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { ActionIconButton } from "@crate-ui/primitives/ActionIconButton";
import { TrackCoverThumb } from "@/components/cards/TrackCoverThumb";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";
import { cn, formatDuration } from "@/lib/utils";
import { albumCoverApiUrl, artistPagePath, albumPagePath } from "@/lib/library-routes";

export interface TrackRowData {
  id?: string | number;
  storage_id?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_slug?: string;
  duration?: number;
  path?: string;
  track_number?: number;
  format?: string;
  library_track_id?: number;
}

interface TrackRowPlaylistOption {
  id: number;
  name: string;
}

interface TrackRowProps {
  track: TrackRowData;
  index?: number;
  showArtist?: boolean;
  showAlbum?: boolean;
  albumCover?: string;
  showCoverThumb?: boolean;
  playlistOptions?: TrackRowPlaylistOption[];
  onAddToPlaylist?: (playlistId: number, track: TrackRowData) => void | Promise<void>;
  onCreatePlaylist?: (track: TrackRowData) => void | Promise<void>;
  onPlayOverride?: () => void;
  /** Pass the full sibling track list so clicking plays all from this track's position. */
  queueTracks?: TrackRowData[];
}

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
  onPlayOverride,
  queueTracks,
}: TrackRowProps) {
  const navigate = useNavigate();
  const { isPlaying } = usePlayerState();
  const { currentTrack, play, playAll, pause, resume } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const { getTrackState } = useOffline();

  const playbackId = track.storage_id || track.path || String(track.id || "");
  const liked = isLiked(
    track.library_track_id ?? (typeof track.id === "number" ? track.id : null),
    track.storage_id,
    track.path,
  );
  const offlineState = getTrackState(track.storage_id);
  const offlineLabel = getOfflineStateLabel(offlineState);
  const isActive = currentTrack?.id === playbackId;
  const cover = albumCover || (track.album_id != null
    ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
    : undefined);

  const playerTrack: Track = {
    id: playbackId,
    storageId: track.storage_id,
    title: track.title || "Unknown",
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover: cover,
    path: track.path,
    libraryTrackId: track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined),
  };
  const actions = useTrackActionEntries({
    track,
    albumCover: cover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
    onPlayNowOverride: onPlayOverride,
  });
  const actionMenu = useItemActionMenu(actions);

  function handleActivate() {
    if (isActive) {
      if (isPlaying) {
        pause();
      } else {
        resume();
      }
      return;
    }
    if (onPlayOverride) {
      onPlayOverride();
      return;
    }
    if (queueTracks && queueTracks.length > 1) {
      const myId = track.storage_id || track.path || String(track.id || "");
      const idx = queueTracks.findIndex((t) => {
        const tId = t.storage_id || t.path || String(t.id || "");
        return tId === myId;
      });
      playAll(queueTracks.map((t) => buildTrackMenuPlayerTrack(t)), Math.max(0, idx));
      return;
    }
    play(playerTrack);
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors cursor-pointer",
        isActive
          ? "bg-primary/10"
          : "hover:bg-white/5",
      )}
      onContextMenu={actionMenu.handleContextMenu}
      onClick={handleActivate}
    >
      {showCoverThumb ? (
        <div className="relative h-11 w-11 flex-shrink-0">
          <TrackCoverThumb
            src={cover}
            iconSize={16}
            className="absolute inset-0 rounded-md"
          />
          <div
            className={`absolute inset-0 flex items-center justify-center rounded-md transition-colors ${
              isActive ? "bg-black/40" : "bg-black/0 group-hover:bg-black/45"
            }`}
          >
            {isActive && isPlaying ? (
              <Pause size={16} className="text-white" fill="currentColor" />
            ) : (
              <Play
                size={16}
                className={`text-white transition-opacity ${isActive ? "opacity-100" : "opacity-0 md:group-hover:opacity-100"}`}
                fill="currentColor"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="w-8 text-center flex-shrink-0">
          {isActive && isPlaying ? (
            <Pause size={14} className="text-primary mx-auto" />
          ) : (
            <>
              <span className="text-xs text-muted-foreground md:group-hover:hidden">
                {index != null ? index : track.track_number || "-"}
              </span>
              <Play size={14} className="text-foreground mx-auto hidden md:group-hover:block" />
            </>
          )}
        </div>
      )}

      {/* Title + optional artist/album */}
      <div className="flex-1 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className={`min-w-0 truncate text-sm ${isActive ? "text-primary font-medium" : "text-foreground"}`}>
            {track.title || "Unknown"}
          </div>
          <OfflineBadge state={offlineState} compact subtle className="flex-shrink-0" />
        </div>
        {(showArtist || showAlbum || offlineLabel) && (
          <div className="text-xs text-muted-foreground truncate">
            {showArtist && (track.artist_id ? (
              <span
                className="hover:text-foreground hover:underline transition-colors cursor-pointer"
                onClick={(e) => { e.stopPropagation(); navigate(artistPagePath({ artistId: track.artist_id, artistSlug: track.artist_slug, artistName: track.artist })); }}
              >
                {track.artist}
              </span>
            ) : track.artist)}
            {showArtist && showAlbum && " · "}
            {showAlbum && (track.album_id ? (
              <span
                className="hover:text-foreground hover:underline transition-colors cursor-pointer"
                onClick={(e) => { e.stopPropagation(); navigate(albumPagePath({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })); }}
              >
                {track.album}
              </span>
            ) : track.album)}
            {(showArtist || showAlbum) && offlineLabel && " · "}
            {offlineLabel ? (
              <span
                className={cn(
                  offlineState === "ready"
                    ? "text-cyan-300/75"
                    : isOfflineBusy(offlineState)
                      ? "text-primary/80"
                      : offlineState === "error"
                        ? "text-amber-300/80"
                        : undefined,
                )}
              >
                {offlineLabel}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Duration */}
      {track.duration != null && track.duration > 0 && (
        <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
          {formatDuration(track.duration)}
        </span>
      )}

      {/* Like + Actions */}
      <ActionIconButton
        variant="row"
        active={liked}
        className={`h-9 w-9 flex-shrink-0 transition-opacity ${
          liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
        }`}
        title={liked ? "Unlike" : "Like"}
        onClick={async (e) => {
          e.stopPropagation();
          const path = track.path || "";
          const trackStorageId = track.storage_id ?? null;
          const libraryTrackId = track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined);
          if (!path && !trackStorageId && libraryTrackId == null) return;
          try {
            await toggleTrackLike(libraryTrackId ?? null, trackStorageId, path);
          } catch {
            // Keep row interaction non-blocking; caller surfaces persistence elsewhere.
          }
        }}
      >
        <Heart
          size={14}
          className={liked ? "fill-current" : ""}
        />
      </ActionIconButton>

      <div className="flex-shrink-0 flex gap-1 opacity-100 md:opacity-65 md:group-hover:opacity-100 transition-opacity">
        <ItemActionMenuButton
          buttonRef={actionMenu.triggerRef}
          hasActions={actionMenu.hasActions}
          onClick={actionMenu.openFromTrigger}
          className="h-9 w-9"
        />
      </div>
      <ItemActionMenu
        actions={actions}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
});
