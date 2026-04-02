import { useNavigate } from "react-router";
import { encPath } from "@/lib/utils";

interface ArtistCardProps {
  name: string;
  photo?: string;
  subtitle?: string;
  compact?: boolean;
  href?: string;
  external?: boolean;
  large?: boolean;
}

export function ArtistCard({ name, photo, subtitle, compact, href, external = false, large = false }: ArtistCardProps) {
  const navigate = useNavigate();
  const photoUrl = photo || `/api/artist/${encPath(name)}/photo`;
  const targetHref = href || `/artist/${encPath(name)}`;
  const imageSize = compact ? 100 : large ? 156 : 140;
  const content = (
    <>
      <div
        className="relative aspect-square rounded-full overflow-hidden bg-white/5 mb-2 mx-auto"
        style={{ width: imageSize, height: imageSize }}
      >
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
    </>
  );

  if (external) {
    return (
      <a
        href={targetHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`group text-left flex-shrink-0 snap-start ${compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"}`}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={`group text-left flex-shrink-0 snap-start ${compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"}`}
      onClick={() => navigate(targetHref)}
    >
      {content}
    </button>
  );
}
