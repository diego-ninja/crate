import { useEffect, useState } from "react";
import { ListMusic } from "lucide-react";

interface TrackCoverThumbProps {
  src?: string;
  className?: string;
  iconSize?: number;
  alt?: string;
}

/**
 * Cover image with graceful fallback to a ListMusic icon when:
 *  - no src is provided
 *  - the image fails to load (network/404)
 *
 * Sizing/rounding/positioning come from the parent via `className`.
 */
export function TrackCoverThumb({ src, className, iconSize = 18, alt = "" }: TrackCoverThumbProps) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  const wrapperClass = `${className ?? ""} overflow-hidden bg-white/5`.trim();

  if (!src || errored) {
    return (
      <div className={`${wrapperClass} flex items-center justify-center`}>
        <ListMusic size={iconSize} className="text-white/25" />
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
    </div>
  );
}
