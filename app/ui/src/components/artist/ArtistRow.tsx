import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath, formatSize, formatCompact } from "@/lib/utils";
import { Users, Wrench, Check } from "lucide-react";

interface ArtistRowProps {
  name: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  listeners?: number;
  genres?: string[];
  primary_format?: string;
  hasIssues?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ArtistRow({
  name,
  albums,
  tracks,
  total_size_mb,
  listeners,
  genres,
  hasIssues,
  selectMode,
  isSelected,
  onClick,
}: ArtistRowProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  function handleClick() {
    if (onClick) {
      onClick();
    } else {
      navigate(`/artist/${encPath(name)}`);
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${
        isSelected ? "bg-primary/10" : ""
      }`}
    >
      {selectMode && (
        <div className="flex-shrink-0">
          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
            isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 bg-transparent"
          }`}>
            {isSelected && <Check size={12} className="text-white" />}
          </div>
        </div>
      )}
      <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 relative">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(name)}/photo`}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
            <span className="text-sm font-bold text-primary/70">{letter}</span>
          </div>
        )}
        {hasIssues && (
          <div className="absolute -top-0.5 -right-0.5 z-10">
            <Wrench size={10} className="text-amber-400/70" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{name}</div>
        {genres && genres.length > 0 && (
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {genres.slice(0, 4).map((g) => (
              <Badge key={g} variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground">
                {g.toLowerCase()}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="text-xs text-muted-foreground whitespace-nowrap">
        {albums} album{albums !== 1 ? "s" : ""}
      </div>
      <div className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {tracks} tracks
      </div>
      <div className="hidden sm:block text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
        {formatSize(total_size_mb)}
      </div>
      {listeners != null && listeners > 0 && (
        <div className="hidden md:flex text-xs text-muted-foreground whitespace-nowrap w-16 text-right items-center justify-end gap-1">
          <Users size={12} />
          {formatCompact(listeners)}
        </div>
      )}
    </div>
  );
}
