import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath } from "@/lib/utils";
import { Music } from "lucide-react";
import { useState } from "react";

interface AlbumRowProps {
  artist: string;
  album: string;
  year?: string;
  tracks?: number;
  format?: string;
  duration?: number;
  size_mb?: number;
  showArtist?: boolean;
  actions?: React.ReactNode;
  coverUrl?: string;
  placeholder?: boolean;
}

export function AlbumRow({
  artist,
  album,
  year,
  tracks,
  format,
  size_mb,
  showArtist = true,
  actions,
  coverUrl,
  placeholder,
}: AlbumRowProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const src = coverUrl ?? `/api/cover/${encPath(artist)}/${encPath(album)}`;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group">
      {/* Cover thumbnail */}
      <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-secondary relative">
        {!placeholder && !imgError ? (
          <img
            src={src}
            alt={album}
            loading="lazy"
            className={`w-full h-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : null}
        {(placeholder || imgError || !imgLoaded) && (
          <div className={`absolute inset-0 bg-gradient-to-br from-cyan-600/20 to-cyan-900/10 flex items-center justify-center ${imgLoaded && !imgError && !placeholder ? "opacity-0" : "opacity-100"}`}>
            <Music size={18} className="text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Title + Artist */}
      <div className="flex-1 min-w-0">
        <Link
          to={`/album/${encPath(artist)}/${encPath(album)}`}
          className="text-sm font-medium text-white/90 hover:text-white truncate block transition-colors"
        >
          {album}
        </Link>
        {showArtist && (
          <Link
            to={`/artist/${encPath(artist)}`}
            className="text-xs text-white/40 hover:text-white/60 truncate block transition-colors"
          >
            {artist}
          </Link>
        )}
      </div>

      {/* Year */}
      {year && (
        <span className="text-xs text-white/30 hidden sm:block w-12 text-center">{year}</span>
      )}

      {/* Track count */}
      {tracks !== undefined && (
        <span className="text-xs text-white/30 hidden md:block w-12 text-center">{tracks}t</span>
      )}

      {/* Format */}
      {format && (
        <Badge variant="outline" className={formatBadgeClass(format)}>
          {format.replace(".", "").toUpperCase()}
        </Badge>
      )}

      {/* Size */}
      {size_mb !== undefined && (
        <span className="text-xs text-white/30 hidden lg:block w-16 text-right">{size_mb} MB</span>
      )}

      {/* Actions slot */}
      {actions && (
        <div className="flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}

function formatBadgeClass(f: string): string {
  const clean = f.replace(".", "").toLowerCase();
  if (clean === "flac") return "border-green-500/30 text-green-500 text-[10px] px-1.5 py-0";
  if (clean === "mp3") return "border-blue-500/30 text-blue-500 text-[10px] px-1.5 py-0";
  if (clean === "m4a") return "border-orange-500/30 text-orange-500 text-[10px] px-1.5 py-0";
  return "text-[10px] px-1.5 py-0";
}
