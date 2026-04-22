import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, Users, Wrench } from "lucide-react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { formatCompact, formatSize } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistRowProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  listeners?: number;
  genres?: string[];
  primary_format?: string;
  hasIssues?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ArtistRow({
  name,
  artistId,
  artistSlug,
  albums,
  tracks,
  total_size_mb,
  listeners,
  genres,
  hasIssues,
  selectMode,
  isSelected,
  onClick,
}: ArtistRowProps) {
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  function handleClick() {
    if (onClick) {
      onClick();
    } else {
      navigate(artistPagePath({ artistId, artistSlug, artistName: name }));
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-white/5 ${
        isSelected ? "bg-white/[0.06]" : ""
      }`}
    >
      {selectMode ? (
        <div className="flex-shrink-0">
          <div className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
            isSelected ? "border-primary bg-primary" : "border-white/35 bg-transparent"
          }`}>
            {isSelected ? <Check size={11} className="text-primary-foreground" /> : null}
          </div>
        </div>
      ) : null}

      <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-md bg-white/5">
        {!imgError ? (
          <img
            src={artistPhotoApiUrl({ artistId, artistSlug, artistName: name })}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/25 to-primary/5">
            <span className="text-sm font-bold text-primary/70">{letter}</span>
          </div>
        )}
        {hasIssues ? (
          <div className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/12 text-amber-300">
            <Wrench size={10} />
          </div>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        {genres && genres.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {genres.slice(0, 3).map((genre) => (
              <CrateChip key={genre}>{genre.toLowerCase()}</CrateChip>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hidden text-xs text-muted-foreground sm:block">{albums} albums</div>
      <div className="hidden w-20 text-right text-xs text-muted-foreground sm:block">{tracks} tracks</div>
      <div className="hidden w-16 text-right text-xs text-muted-foreground lg:block">{formatSize(total_size_mb)}</div>
      {listeners != null && listeners > 0 ? (
        <div className="hidden w-20 items-center justify-end gap-1 text-xs text-muted-foreground md:flex">
          <Users size={12} />
          {formatCompact(listeners)}
        </div>
      ) : null}
    </div>
  );
}
