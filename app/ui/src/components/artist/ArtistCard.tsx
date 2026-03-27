import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath, formatSize } from "@/lib/utils";
import { Wrench, Check } from "lucide-react";

interface ArtistCardProps {
  name: string;
  albums: number;
  tracks: number;
  size_mb: number;
  primary_format: string;
  hasIssues?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ArtistCard({
  name,
  albums,
  tracks,
  size_mb,
  primary_format,
  hasIssues,
  selectMode,
  isSelected,
  onClick,
}: ArtistCardProps) {
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
      className={`bg-card border rounded-lg p-3 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 ${
        isSelected ? "border-primary ring-2 ring-primary/40" : "border-border hover:border-primary"
      }`}
    >
      <div className="relative w-full aspect-square rounded-lg mb-2 overflow-hidden">
        {selectMode && (
          <div className="absolute top-2 left-2 z-10">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected ? "bg-primary border-primary" : "border-white/50 bg-black/30"
            }`}>
              {isSelected && <Check size={12} className="text-white" />}
            </div>
          </div>
        )}
        {hasIssues && (
          <div className="absolute top-2 right-2 z-10">
            <Wrench size={14} className="text-amber-400/70" />
          </div>
        )}
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
            <span className="text-4xl font-bold text-primary/70">{letter}</span>
          </div>
        )}
      </div>
      <div className="font-semibold text-sm truncate">{name}</div>
      <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap mt-1">
        <span>{albums} album{albums !== 1 ? "s" : ""}</span>
        <span>&middot;</span>
        <span>{tracks} tracks</span>
        <span>&middot;</span>
        <span>{formatSize(size_mb)}</span>
        {primary_format && (
          <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">
            {primary_format.replace(".", "").toUpperCase()}
          </Badge>
        )}
      </div>
    </div>
  );
}
