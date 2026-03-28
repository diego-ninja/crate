import { useNavigate } from "react-router";
import { encPath } from "@/lib/utils";

interface ArtistCardProps {
  name: string;
  photo?: string;
  subtitle?: string;
  compact?: boolean;
}

export function ArtistCard({ name, photo, subtitle, compact }: ArtistCardProps) {
  const navigate = useNavigate();
  const photoUrl = photo || `/api/artist/${encPath(name)}/photo`;

  return (
    <button
      className={`group text-left flex-shrink-0 ${compact ? "w-[100px]" : "w-[140px]"}`}
      onClick={() => navigate(`/artist/${encPath(name)}`)}
    >
      <div className="relative aspect-square rounded-full overflow-hidden bg-white/5 mb-2 mx-auto"
        style={{ width: compact ? 100 : 140, height: compact ? 100 : 140 }}>
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>
      <div className="truncate text-sm font-medium text-foreground text-center">{name}</div>
      {subtitle && (
        <div className="truncate text-xs text-muted-foreground text-center">{subtitle}</div>
      )}
    </button>
  );
}
