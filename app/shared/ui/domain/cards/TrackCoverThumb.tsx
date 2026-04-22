import { useEffect, useState } from "react";
import { ListMusic } from "lucide-react";

interface TrackCoverThumbProps {
  src?: string;
  className?: string;
  iconSize?: number;
  alt?: string;
}

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
