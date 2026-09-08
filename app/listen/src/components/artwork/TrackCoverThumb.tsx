import { ListMusic } from "@crate/ui/icons";

import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";

interface TrackCoverThumbProps {
  src?: string;
  className?: string;
  iconSize?: number;
  alt?: string;
}

export function TrackCoverThumb({
  src,
  className,
  iconSize = 18,
  alt = "",
}: TrackCoverThumbProps) {
  return (
    <ArtworkSurface
      source={src}
      alt={alt}
      className={`${className ?? ""} overflow-hidden bg-text-primary/5`.trim()}
      fallback={
        <div className="flex size-full items-center justify-center">
          <ListMusic size={iconSize} className="text-text-primary/25" />
        </div>
      }
      imageProps={{
        loading: "lazy",
        decoding: "async",
      }}
      imageClassName="object-cover"
    />
  );
}
