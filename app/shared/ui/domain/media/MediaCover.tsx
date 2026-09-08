import { useEffect, useState } from "react";
import type { CrateIcon } from "@crate/ui/icons";
import { Music } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import type { MediaImageShape } from "./MediaEntity";

export interface MediaCoverProps {
  src?: string | null;
  fallbackUrl?: string | null;
  alt?: string;
  fallbackIcon?: CrateIcon;
  iconSize?: number;
  shape?: MediaImageShape;
  className?: string;
}

export function MediaCover({
  src,
  fallbackUrl,
  alt = "",
  fallbackIcon,
  iconSize = 18,
  shape = "square",
  className,
}: MediaCoverProps) {
  const [primaryErrored, setPrimaryErrored] = useState(false);
  const [fallbackErrored, setFallbackErrored] = useState(false);

  useEffect(() => {
    setPrimaryErrored(false);
    setFallbackErrored(false);
  }, [fallbackUrl, src]);

  const showingPrimary = Boolean(src && !primaryErrored);
  const imageSrc = showingPrimary
    ? src
    : fallbackUrl && !fallbackErrored
      ? fallbackUrl
      : null;

  const baseClasses = cn(
    "overflow-hidden bg-text-primary/5",
    shapeClass(shape),
    className,
  );

  if (!imageSrc) {
    const Icon = fallbackIcon ?? Music;

    return (
      <div
        className={cn(baseClasses, "flex items-center justify-center")}
        data-testid="media-cover-fallback"
      >
        <Icon size={iconSize} className="text-text-primary/25" />
      </div>
    );
  }

  return (
    <div className={baseClasses}>
      <img
        src={imageSrc}
        alt={alt}
        loading="lazy"
        className=" size-full object-cover"
        onError={() => {
          if (showingPrimary) {
            setPrimaryErrored(true);
          } else {
            setFallbackErrored(true);
          }
        }}
        data-testid="media-cover-image"
      />
    </div>
  );
}

function shapeClass(shape: MediaImageShape): string {
  if (shape === "circle") return "rounded-full";
  if (shape === "rounded") return "rounded-2xl";
  return "rounded-lg";
}
