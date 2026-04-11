import React, { useState } from "react";
import { useNavigate } from "react-router";
import { formatBadgeClass } from "@/lib/utils";
import { Music, Play, Heart, ListPlus } from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";

interface AlbumCardProps {
  albumId?: number;
  albumSlug?: string;
  artist: string;
  artistId?: number;
  artistSlug?: string;
  name: string;
  displayName?: string;
  year?: string;
  tracks: number;
  formats: string[];
  hasCover?: boolean;
  showHeart?: boolean;
  showQueue?: boolean;
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 30%, 15%)`;
}



export const AlbumCard = React.memo(function AlbumCard({
  albumId,
  albumSlug,
  artist,
  artistId,
  artistSlug,
  name,
  displayName,
  year,
  tracks,
  formats,
  showHeart = true,
  showQueue = true,
}: AlbumCardProps) {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  
  const { isFavorite, toggleFavorite } = useFavorites();
  const coverUrl = albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: name });
  const favId = `${artist}/${name}`;

  function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: name }));
  }

  return (
    <MusicContextMenu
      type="album"
      artist={artist}
      artistId={artistId}
      artistSlug={artistSlug}
      album={name}
      albumId={albumId}
      albumSlug={albumSlug}
    >
      <div
        onClick={() => navigate(albumPagePath({ albumId, albumSlug, artistName: artist, albumName: name }))}
        className="bg-card border border-border rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 hover:border-primary text-center group"
      >
        <div className="w-full aspect-square rounded-lg bg-secondary overflow-hidden mb-2 relative">
          {!imgError ? (
            <img
              src={coverUrl}
              alt={name}
              loading="lazy"
              className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgError(true)}
            />
          ) : null}
          {(imgError || !imgLoaded) && (
            <div
              className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${imgLoaded && !imgError ? "opacity-0" : "opacity-100"}`}
              style={{ background: `linear-gradient(135deg, ${hashColor(name)}, ${hashColor(name + name)})` }}
            >
              <span className="text-3xl font-bold text-white/25">{name.charAt(0).toUpperCase()}</span>
              <Music size={16} className="text-white/10 absolute bottom-2 right-2" />
            </div>
          )}
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <button
              onClick={handlePlay}
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-black/40 hover:bg-primary/80 transition-colors hover:scale-110"
            >
              <Play size={20} className="text-white fill-white ml-0.5" />
            </button>
            {showHeart && (
              <button
                onClick={(e) => { e.stopPropagation(); toggleFavorite(favId, "album"); }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <Heart size={15} className={isFavorite(favId) ? "fill-red-500 text-red-500" : "text-white"} />
              </button>
            )}
            {showQueue && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlay(e);
                }}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                title="Add to queue"
              >
                <ListPlus size={15} className="text-white" />
              </button>
            )}
          </div>
          {/* Favorite indicator (always visible if favorited) */}
          {isFavorite(favId) && (
            <div className="absolute top-2 right-2 z-10">
              <Heart size={14} className="fill-red-500 text-red-500 drop-shadow-md" />
            </div>
          )}
        </div>
        <div className="font-semibold text-sm text-left truncate">{displayName || name}</div>
        <div className="text-xs text-muted-foreground text-left flex items-center gap-1 flex-wrap mt-0.5">
          <span>{year || "?"}</span>
          <span>&middot;</span>
          <span>{tracks}t</span>
          {formats.map((f) => (
            <span key={f} className={formatBadgeClass(f)}>
              {f.replace(".", "").toUpperCase()}
            </span>
          ))}
        </div>
      </div>
    </MusicContextMenu>
  );
});
