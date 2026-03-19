import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { encPath, formatSize } from "@/lib/utils";

interface ArtistCardProps {
  name: string;
  albums: number;
  tracks: number;
  size_mb: number;
  primary_format: string;
}

export function ArtistCard({
  name,
  albums,
  tracks,
  size_mb,
  primary_format,
}: ArtistCardProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);

  const letter = name.charAt(0).toUpperCase();

  return (
    <div
      onClick={() => navigate(`/artist/${encPath(name)}`)}
      className="bg-card border border-border rounded-lg p-4 cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/5 hover:border-primary"
    >
      <div className="w-full aspect-square rounded-lg mb-3 overflow-hidden">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(name)}/photo`}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
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
