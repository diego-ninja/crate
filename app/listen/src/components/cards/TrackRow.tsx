import { Play, Pause, Plus, ListPlus } from "lucide-react";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { formatDuration, encPath } from "@/lib/utils";

interface TrackRowProps {
  track: {
    id?: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    path?: string;
    track_number?: number;
    format?: string;
    navidrome_id?: string;
  };
  index?: number;
  showArtist?: boolean;
  showAlbum?: boolean;
  albumCover?: string;
}

export function TrackRow({ track, index, showArtist = false, showAlbum = false, albumCover }: TrackRowProps) {
  const { currentTrack, isPlaying } = usePlayer();
  const { play, addToQueue, playNext } = usePlayerActions();

  const trackId = track.navidrome_id || track.path || track.id || "";
  const isActive = currentTrack?.id === trackId;
  const cover = albumCover || (track.artist && track.album
    ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
    : undefined);

  const playerTrack: Track = {
    id: trackId,
    title: track.title || "Unknown",
    artist: track.artist,
    album: track.album,
    albumCover: cover,
  };

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2 rounded-lg transition-colors cursor-pointer
        ${isActive ? "bg-primary/10" : "hover:bg-white/5"}`}
      onClick={() => play(playerTrack)}
    >
      {/* Track number / play indicator */}
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

      {/* Actions (on hover) */}
      <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="p-1 text-muted-foreground hover:text-foreground"
          title="Play next"
          onClick={(e) => { e.stopPropagation(); playNext(playerTrack); }}
        >
          <ListPlus size={14} />
        </button>
        <button
          className="p-1 text-muted-foreground hover:text-foreground"
          title="Add to queue"
          onClick={(e) => { e.stopPropagation(); addToQueue(playerTrack); }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
