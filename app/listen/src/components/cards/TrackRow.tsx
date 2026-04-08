import { memo } from "react";
import { Play, Pause, Heart } from "lucide-react";
import { ItemActionMenu, ItemActionMenuButton, useItemActionMenu } from "@/components/actions/ItemActionMenu";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { usePlayerState, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { TrackCoverThumb } from "@/components/cards/TrackCoverThumb";
import { formatDuration } from "@/lib/utils";
import { albumCoverApiUrl } from "@/lib/library-routes";

export interface TrackRowData {
  id?: string | number;
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
  navidrome_id?: string;
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
}: TrackRowProps) {
  const { isPlaying } = usePlayerState();
  const { currentTrack, play, pause, resume } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();

  const playbackId = track.path || String(track.id || track.navidrome_id || "");
  const liked = isLiked(track.library_track_id ?? (typeof track.id === "number" ? track.id : null), track.path);
  const isActive = currentTrack?.id === playbackId;
  const cover = albumCover || (track.album_id != null
    ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
    : undefined);

  const playerTrack: Track = {
    id: playbackId,
    title: track.title || "Unknown",
    artist: track.artist,
    artistId: track.artist_id,
    artistSlug: track.artist_slug,
    album: track.album,
    albumId: track.album_id,
    albumSlug: track.album_slug,
    albumCover: cover,
    path: track.path,
    navidromeId: track.navidrome_id,
    libraryTrackId: track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined),
  };
  const actions = useTrackActionEntries({
    track,
    albumCover: cover,
    playlistOptions,
    onAddToPlaylist,
    onCreatePlaylist,
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
    play(playerTrack);
  }

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer
        ${isActive ? "bg-primary/10" : "hover:bg-white/5"}`}
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
            <span className="text-xs text-muted-foreground group-hover:hidden">
              {index != null ? index : track.track_number || "-"}
            </span>
          )}
          {!(isActive && isPlaying) && (
            <Play size={14} className="text-foreground mx-auto hidden group-hover:block" />
          )}
        </div>
      )}

      {/* Title + optional artist/album */}
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate ${isActive ? "text-primary font-medium" : "text-foreground"}`}>
          {track.title || "Unknown"}
        </div>
        {(showArtist || showAlbum) && (
          <div className="text-xs text-muted-foreground truncate">
            {showArtist && track.artist}
            {showArtist && showAlbum && " · "}
            {showAlbum && track.album}
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
        className={`h-8 w-8 flex-shrink-0 transition-opacity ${
          liked ? "opacity-100" : "md:opacity-0 md:group-hover:opacity-100"
        }`}
        title={liked ? "Unlike" : "Like"}
        onClick={async (e) => {
          e.stopPropagation();
          const path = track.path || "";
          const libraryTrackId = track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined);
          if (!path && libraryTrackId == null) return;
          try {
            await toggleTrackLike(libraryTrackId ?? null, path);
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
          className="h-8 w-8"
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
