import { useNavigate } from "react-router";
import { Play } from "lucide-react";
import { encPath } from "@/lib/utils";

interface AlbumCardProps {
  artist: string;
  album: string;
  year?: string;
  cover?: string;
  compact?: boolean;
}

export function AlbumCard({ artist, album, year, cover, compact }: AlbumCardProps) {
  const navigate = useNavigate();
  const coverUrl = cover || `/api/cover/${encPath(artist)}/${encPath(album)}`;

  return (
    <button
      className={`group text-left flex-shrink-0 ${compact ? "w-[120px]" : "w-[160px]"}`}
      onClick={() => navigate(`/album/${encPath(artist)}/${encPath(album)}`)}
    >
      <div className="relative aspect-square rounded-lg overflow-hidden bg-white/5 mb-2">
        <img
          src={coverUrl}
          alt={album}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 shadow-lg">
            <Play size={18} fill="#0a0a0f" className="text-primary-foreground ml-0.5" />
          </div>
        </div>
      </div>
      <div className="truncate text-sm font-medium text-foreground">{album}</div>
      <div className="truncate text-xs text-muted-foreground">
        {year ? `${year} · ${artist}` : artist}
      </div>
    </button>
  );
}
