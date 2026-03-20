import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath } from "@/lib/utils";
import { Music, Play } from "lucide-react";
import { usePlayer, type Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

interface AlbumCardProps {
  artist: string;
  name: string;
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

interface NavidromeSong {
  id: string;
  title: string;
  track: number;
  duration: number;
}

interface NavidromeAlbumLink {
  id: string;
  name: string;
  songs: NavidromeSong[];
  navidrome_url: string;
}

export function AlbumCard({
  artist,
  name,
  year,
  tracks,
  formats,
}: AlbumCardProps) {
  const navigate = useNavigate();
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const player = usePlayer();
  const coverUrl = `/api/cover/${encPath(artist)}/${encPath(name)}`;

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const data = await api<NavidromeAlbumLink>(
        `/api/navidrome/album/${encPath(artist)}/${encPath(name)}/link`,
      );
      if (data?.songs?.length) {
        const playerTracks: Track[] = data.songs.map((s) => ({
          id: s.id,
          title: s.title,
          artist,
          albumCover: coverUrl,
        }));
        player.playAll(playerTracks);
      }
    } catch {
      // navidrome not linked, navigate instead
      navigate(`/album/${encPath(artist)}/${encPath(name)}`);
    }
  }

  return (
    <div
      onClick={() => navigate(`/album/${encPath(artist)}/${encPath(name)}`)}
      className="bg-card border border-border rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 hover:border-primary text-center group"
    >
      <div className="w-full aspect-square rounded-md bg-secondary overflow-hidden mb-2 relative">
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
        {/* Play overlay */}
        <div
          onClick={handlePlay}
          className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
        >
          <div className="w-12 h-12 rounded-full bg-cyan-600 flex items-center justify-center shadow-lg shadow-black/40 hover:bg-cyan-500 transition-colors hover:scale-110">
            <Play size={22} className="text-white fill-white ml-0.5" />
          </div>
        </div>
      </div>
      <div className="font-semibold text-sm text-left truncate">{name}</div>
      <div className="text-xs text-muted-foreground text-left flex items-center gap-1 flex-wrap mt-0.5">
        <span>{year || "?"}</span>
        <span>&middot;</span>
        <span>{tracks}t</span>
        {formats.map((f) => (
          <Badge
            key={f}
            variant="outline"
            className={formatClass(f)}
          >
            {f.replace(".", "").toUpperCase()}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function formatClass(f: string): string {
  const clean = f.replace(".", "").toLowerCase();
  if (clean === "flac") return "border-green-500/30 text-green-500 text-[10px] px-1 py-0";
  if (clean === "mp3") return "border-blue-500/30 text-blue-500 text-[10px] px-1 py-0";
  if (clean === "m4a") return "border-orange-500/30 text-orange-500 text-[10px] px-1 py-0";
  return "text-[10px] px-1 py-0";
}
