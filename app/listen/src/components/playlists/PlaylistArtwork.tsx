import { ListMusic } from "lucide-react";

import { encPath } from "@/lib/utils";

export interface PlaylistArtworkTrack {
  artist?: string;
  album?: string;
}

interface PlaylistArtworkProps {
  name?: string;
  coverDataUrl?: string | null;
  tracks?: PlaylistArtworkTrack[];
  className?: string;
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

function buildCoverUrl(track: PlaylistArtworkTrack): string | null {
  if (!track.artist || !track.album) return null;
  return `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`;
}

export function PlaylistArtwork({
  name = "Playlist",
  coverDataUrl,
  tracks = [],
  className = "",
}: PlaylistArtworkProps) {
  const collageSources: string[] = [];
  for (const track of tracks) {
    const source = buildCoverUrl(track);
    if (source && !collageSources.includes(source)) {
      collageSources.push(source);
    }
    if (collageSources.length >= 4) break;
  }

  if (coverDataUrl) {
    return (
      <div className={`relative overflow-hidden bg-white/5 ${className}`}>
        <img src={coverDataUrl} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }

  if (collageSources.length > 0) {
    if (collageSources.length === 1) {
      return (
        <div className={`relative overflow-hidden bg-white/5 ${className}`}>
          <img src={collageSources[0]} alt={name} className="w-full h-full object-cover" />
        </div>
      );
    }

    const collageClassName =
      collageSources.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

    return (
      <div className={`grid ${collageClassName} gap-[2px] overflow-hidden bg-white/5 ${className}`}>
        {collageSources.map((source, index) => (
          <img
            key={`${source}-${index}`}
            src={source}
            alt=""
            className={`w-full h-full object-cover ${collageSources.length === 3 && index === 2 ? "col-span-2" : ""}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden flex items-center justify-center ${className}`}
      style={{ background: playlistGradient(name) }}
    >
      <ListMusic size={24} className="text-white/60" />
    </div>
  );
}
