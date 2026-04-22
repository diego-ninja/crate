import { Link } from "react-router";
import { Music } from "lucide-react";
import { useState } from "react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { albumCoverApiUrl, albumPagePath, artistPagePath } from "@/lib/library-routes";

interface AlbumRowProps {
  artist: string;
  artistId?: number;
  artistSlug?: string;
  album: string;
  albumId?: number;
  albumSlug?: string;
  year?: string;
  tracks?: number;
  format?: string;
  duration?: number;
  size_mb?: number;
  showArtist?: boolean;
  actions?: React.ReactNode;
  coverUrl?: string;
  placeholder?: boolean;
}

export function AlbumRow({
  artist,
  artistId,
  artistSlug,
  album,
  albumId,
  albumSlug,
  year,
  tracks,
  format,
  size_mb,
  showArtist = true,
  actions,
  coverUrl,
  placeholder,
}: AlbumRowProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const src = coverUrl ?? albumCoverApiUrl({ albumId, albumSlug, artistName: artist, albumName: album });

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-white/5">
      <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-white/5">
        {!placeholder && !imgError ? (
          <img
            src={src}
            alt={album}
            loading="lazy"
            className={`h-full w-full object-cover transition-opacity duration-300 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : null}
        {(placeholder || imgError || !imgLoaded) ? (
          <div className={`absolute inset-0 flex items-center justify-center bg-white/5 ${imgLoaded && !imgError && !placeholder ? "opacity-0" : "opacity-100"}`}>
            <Music size={18} className="text-muted-foreground/30" />
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <Link
          to={albumPagePath({ albumId, albumSlug, artistName: artist, albumName: album })}
          className="block truncate text-sm font-medium text-white/90 transition-colors hover:text-white"
        >
          {album}
        </Link>
        {showArtist ? (
          <Link
            to={artistPagePath({ artistId, artistSlug, artistName: artist })}
            className="block truncate text-xs text-white/40 transition-colors hover:text-white/65"
          >
            {artist}
          </Link>
        ) : null}
      </div>

      {year ? <span className="hidden w-12 text-center text-xs text-white/30 sm:block">{year}</span> : null}
      {tracks !== undefined ? <span className="hidden w-14 text-center text-xs text-white/30 md:block">{tracks}t</span> : null}
      {format ? <CrateChip>{format.replace(".", "").toUpperCase()}</CrateChip> : null}
      {size_mb !== undefined ? <span className="hidden w-16 text-right text-xs text-white/30 lg:block">{size_mb} MB</span> : null}
      {actions ? <div className="flex-shrink-0">{actions}</div> : null}
    </div>
  );
}
