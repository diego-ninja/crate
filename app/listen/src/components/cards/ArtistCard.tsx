import { useNavigate } from "react-router";
import { cn, encPath } from "@/lib/utils";

interface ArtistCardProps {
  name: string;
  photo?: string;
  subtitle?: string;
  compact?: boolean;
  href?: string;
  external?: boolean;
  large?: boolean;
  layout?: "rail" | "grid";
}

export function ArtistCard({
  name,
  photo,
  subtitle,
  compact,
  href,
  external = false,
  large = false,
  layout = "rail",
}: ArtistCardProps) {
  const navigate = useNavigate();
  const photoUrl = photo || `/api/artist/${encPath(name)}/photo`;
  const targetHref = href || `/artist/${encPath(name)}`;
  const imageSize = compact ? 100 : large ? 156 : 140;
  const wrapperClassName = cn(
    "group snap-start text-left",
    layout === "grid"
      ? "w-full min-w-0"
      : `flex-shrink-0 ${compact ? "w-[100px]" : large ? "w-[156px]" : "w-[140px]"}`,
  );
  const content = (
    <>
      <div
        className="relative mx-auto mb-2 aspect-square overflow-hidden rounded-full bg-white/5"
        style={{
          width: layout === "grid" ? "100%" : imageSize,
          maxWidth: imageSize,
          height: layout === "grid" ? "auto" : imageSize,
        }}
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
        className={wrapperClassName}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={wrapperClassName}
      onClick={() => navigate(targetHref)}
    >
      {content}
    </button>
  );
}
