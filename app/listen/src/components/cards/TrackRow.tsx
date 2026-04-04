import { memo, useEffect, useRef, useState } from "react";
import { Play, Pause, Plus, ListPlus, Heart, ListMusic } from "lucide-react";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { formatDuration, encPath } from "@/lib/utils";

export interface TrackRowData {
  id?: string | number;
  title: string;
  artist: string;
  album?: string;
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
  const { currentTrack, isPlaying } = usePlayer();
  const { play, pause, resume, addToQueue, playNext } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const playlistMenuRef = useRef<HTMLDivElement>(null);

  const playbackId = track.path || String(track.id || track.navidrome_id || "");
  const liked = isLiked(track.library_track_id ?? (typeof track.id === "number" ? track.id : null), track.path);
  const isActive = currentTrack?.id === playbackId;
  const cover = albumCover || (track.artist && track.album
    ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
    : undefined);

  const playerTrack: Track = {
    id: playbackId,
    title: track.title || "Unknown",
    artist: track.artist,
    album: track.album,
    albumCover: cover,
    path: track.path,
    navidromeId: track.navidrome_id,
    libraryTrackId: track.library_track_id ?? (typeof track.id === "number" ? track.id : undefined),
  };

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

  useEffect(() => {
    if (!playlistMenuOpen) return undefined;
    const handleClickOutside = (event: MouseEvent) => {
      if (playlistMenuRef.current && !playlistMenuRef.current.contains(event.target as Node)) {
        setPlaylistMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [playlistMenuOpen]);

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer
        ${isActive ? "bg-primary/10" : "hover:bg-white/5"}`}
      onClick={handleActivate}
    >
      {showCoverThumb && cover ? (
        <div className="relative w-11 h-11 rounded-md overflow-hidden bg-white/5 flex-shrink-0">
          <img src={cover} alt="" className="w-full h-full object-cover" />
          <div
            className={`absolute inset-0 flex items-center justify-center transition-colors ${
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

      {/* Actions (visible on mobile, hover-reveal on desktop) */}
      <div className="flex-shrink-0 flex gap-1 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        {onAddToPlaylist && (
          <div className="relative" ref={playlistMenuRef}>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white"
              title="Add to playlist"
              onClick={(e) => {
                e.stopPropagation();
                setPlaylistMenuOpen((open) => !open);
              }}
            >
              <ListMusic size={14} />
            </button>
            {playlistMenuOpen && (
              <div className="z-app-popover absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/10 bg-popover-surface py-1 shadow-2xl backdrop-blur-xl">
                {onCreatePlaylist ? (
                  <button
                    className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-white/5 transition-colors"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await onCreatePlaylist(track);
                      setPlaylistMenuOpen(false);
                    }}
                  >
                    Add new playlist
                  </button>
                ) : null}
                {onCreatePlaylist && playlistOptions && playlistOptions.length > 0 ? (
                  <div className="mx-3 my-1 h-px bg-white/10" />
                ) : null}
                {playlistOptions && playlistOptions.length > 0 ? (
                  playlistOptions.map((playlist) => (
                    <button
                      key={playlist.id}
                      className="w-full px-3 py-2 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await onAddToPlaylist(playlist.id, track);
                        setPlaylistMenuOpen(false);
                      }}
                    >
                      {playlist.name}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No playlists yet</div>
                )}
              </div>
            )}
          </div>
        )}
        <ActionIconButton
          className="h-8 w-8"
          title="Play next"
          onClick={(e) => { e.stopPropagation(); playNext(playerTrack); }}
        >
          <ListPlus size={14} />
        </ActionIconButton>
        <ActionIconButton
          className="h-8 w-8"
          title="Add to queue"
          onClick={(e) => { e.stopPropagation(); addToQueue(playerTrack); }}
        >
          <Plus size={14} />
        </ActionIconButton>
      </div>
    </div>
  );
});
