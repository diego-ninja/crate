import React, { useState } from "react";
import { useNavigate } from "react-router";
import { formatBadgeClass } from "@/lib/utils";
import { Music, ImageDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { api } from "@/lib/api";
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
}: AlbumCardProps) {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [fetchingCover, setFetchingCover] = useState(false);
  const coverUrl = albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: name });

  async function handleFetchCover(e: React.MouseEvent) {
    e.stopPropagation();
    if (!albumId || fetchingCover) return;
    setFetchingCover(true);
    try {
      await api(`/api/albums/${albumId}/fetch-cover`, "POST");
      toast.success("Searching for cover...");
      // Poll for completion then reload image
      setTimeout(() => {
        setImgError(false);
        setImgLoaded(false);
        setFetchingCover(false);
      }, 8000);
    } catch {
      toast.error("Failed to search for cover");
      setFetchingCover(false);
    }
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
              {imgError && albumId && (
                <button
                  onClick={handleFetchCover}
                  disabled={fetchingCover}
                  className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors"
                  title="Search for cover"
                >
                  {fetchingCover ? <Loader2 size={13} className="text-white/50 animate-spin" /> : <ImageDown size={13} className="text-white/40" />}
                </button>
              )}
              {!imgError && <Music size={16} className="text-white/10 absolute bottom-2 right-2" />}
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
