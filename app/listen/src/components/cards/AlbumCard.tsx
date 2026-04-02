import { memo, useState } from "react";
import { useNavigate } from "react-router";
import { Heart, Loader2, Play } from "lucide-react";

import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";

interface AlbumCardProps {
  artist: string;
  album: string;
  albumId?: number;
  year?: string;
  cover?: string;
  compact?: boolean;
}

interface AlbumData {
  artist: string;
  name: string;
  display_name: string;
  tracks: Array<{
    id: number;
    filename: string;
    path: string;
    length_sec: number;
    tags: {
      title: string;
    };
  }>;
}

export const AlbumCard = memo(function AlbumCard({ artist, album, albumId, year, cover, compact }: AlbumCardProps) {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const [playing, setPlaying] = useState(false);
  const coverUrl = cover || `/api/cover/${encPath(artist)}/${encPath(album)}`;
  const saved = isSaved(albumId);

  async function handlePlayOverlay(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setPlaying(true);
    try {
      const data = await api<AlbumData>(`/api/album/${encPath(artist)}/${encPath(album)}`);
      const playerTracks: Track[] = (data.tracks || []).map((track) => ({
        id: track.path || String(track.id),
        title: track.tags?.title || track.filename || "Unknown",
        artist: data.artist,
        album: data.display_name || data.name,
        albumCover: coverUrl,
        path: track.path,
        libraryTrackId: track.id,
      }));
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, {
          type: "album",
          name: `${artist} - ${album}`,
          radio: albumId != null ? { seedType: "album", seedId: albumId } : undefined,
        });
      }
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group text-left flex-shrink-0 snap-start ${compact ? "w-[120px]" : "w-[160px]"}`}
      onClick={() => navigate(`/album/${encPath(artist)}/${encPath(album)}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate(`/album/${encPath(artist)}/${encPath(album)}`);
        }
      }}
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
        <img
          src={coverUrl}
          alt={album}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        {albumId != null && (
          <button
            className="absolute top-2 right-2 z-10 w-9 h-9 rounded-full bg-black/55 backdrop-blur-md border border-white/10 flex items-center justify-center text-white/75 hover:text-white hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
            onClick={async (event) => {
              event.stopPropagation();
              try {
                await toggleAlbumSaved(albumId);
              } catch {
                // no-op; page-level toasts can be added later
              }
            }}
          >
            <Heart size={16} className={saved ? "text-primary fill-primary" : ""} />
          </button>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
          <button
            className="w-10 h-10 rounded-full bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 shadow-lg"
            onClick={handlePlayOverlay}
          >
            {playing ? (
              <Loader2 size={18} className="text-primary-foreground animate-spin" />
            ) : (
              <Play size={18} fill="#0a0a0f" className="text-primary-foreground ml-0.5" />
            )}
          </button>
        </div>
      </div>
      <div className="truncate text-sm font-medium text-foreground">{album}</div>
      <div className="truncate text-xs text-muted-foreground">
        {year ? `${year} · ${artist}` : artist}
      </div>
    </div>
  );
});
