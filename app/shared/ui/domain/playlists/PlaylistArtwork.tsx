import { ListMusic } from "lucide-react";

export interface PlaylistArtworkTrack {
  artist?: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album?: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
}

interface PlaylistArtworkProps {
  name?: string;
  coverDataUrl?: string | null;
  tracks?: PlaylistArtworkTrack[];
  className?: string;
  showCrateMark?: boolean;
  crateMarkClassName?: string;
  logoSrc?: string;
  buildCoverUrl: (track: PlaylistArtworkTrack) => string | null;
}

function playlistGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 44) % 360;
  return `linear-gradient(145deg, hsl(${hue1}, 42%, 30%), hsl(${hue2}, 55%, 18%))`;
}

function CrateMark({ logoSrc, className = "" }: { logoSrc: string; className?: string }) {
  return (
    <div className={`absolute right-2.5 top-2.5 flex items-center justify-center ${className}`}>
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className="h-4 w-4 opacity-95 drop-shadow-[0_1px_6px_rgba(0,0,0,0.45)]"
      />
    </div>
  );
}

export function PlaylistArtwork({
  name = "Playlist",
  coverDataUrl,
  tracks = [],
  className = "",
  showCrateMark = false,
  crateMarkClassName,
  logoSrc = "/icons/logo.svg",
  buildCoverUrl,
}: PlaylistArtworkProps) {
  const collageSources: string[] = [];
  for (const track of tracks) {
    const source = buildCoverUrl(track);
    if (source && !collageSources.includes(source)) {
      collageSources.push(source);
    }
    if (collageSources.length >= 4) break;
  }

  const crateMark = showCrateMark ? <CrateMark logoSrc={logoSrc} className={crateMarkClassName} /> : null;

  if (coverDataUrl) {
    return (
      <div className={`relative overflow-hidden bg-white/5 ${className}`}>
        <img src={coverDataUrl} alt={name} className="w-full h-full object-cover" />
        {crateMark}
      </div>
    );
  }

  if (collageSources.length > 0) {
    if (collageSources.length === 1) {
      return (
        <div className={`relative overflow-hidden bg-white/5 ${className}`}>
          <img src={collageSources[0]} alt={name} className="w-full h-full object-cover" />
          {crateMark}
        </div>
      );
    }

    const collageClassName =
      collageSources.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

    return (
      <div className={`relative overflow-hidden bg-white/5 ${className}`}>
        <div className={`grid h-full w-full ${collageClassName} gap-[2px]`}>
          {collageSources.map((source, index) => (
            <img
              key={`${source}-${index}`}
              src={source}
              alt=""
              className={`w-full h-full object-cover ${collageSources.length === 3 && index === 2 ? "col-span-2" : ""}`}
            />
          ))}
        </div>
        {crateMark}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: playlistGradient(name) }}
    >
      <ListMusic size={24} className="text-white/60" />
      {crateMark}
    </div>
  );
}
