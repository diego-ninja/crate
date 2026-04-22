import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, Wrench } from "lucide-react";

import { CrateChip } from "@crate-ui/primitives/CrateBadge";
import { formatSize } from "@/lib/utils";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

interface ArtistCardProps {
  name: string;
  artistId?: number;
  artistSlug?: string;
  albums: number;
  tracks: number;
  size_mb: number;
  primary_format: string;
  hasIssues?: boolean;
  selectMode?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function ArtistCard({
  name,
  artistId,
  artistSlug,
  albums,
  tracks,
  size_mb,
  primary_format,
  hasIssues,
  selectMode,
  isSelected,
  onClick,
}: ArtistCardProps) {
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
      className={`group cursor-pointer rounded-md p-2 text-left transition-colors hover:bg-white/5 ${
        isSelected ? "bg-white/[0.06]" : ""
      }`}
    >
      <div className="relative mx-auto mb-3 aspect-square w-full overflow-hidden rounded-md bg-white/5">
        {selectMode ? (
          <div className="absolute left-2 top-2 z-10">
            <div className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
              isSelected ? "border-primary bg-primary" : "border-white/40 bg-black/40"
            }`}>
              {isSelected ? <Check size={11} className="text-primary-foreground" /> : null}
            </div>
          </div>
        ) : null}
        {hasIssues ? (
          <div className="absolute right-2 top-2 z-10">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-amber-400/20 bg-amber-500/12 text-amber-300">
              <Wrench size={13} />
            </div>
          </div>
        ) : null}

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
            <span className="text-4xl font-bold text-primary/60">{letter}</span>
          </div>
        )}
      </div>

      <div className="truncate text-center text-sm font-medium text-foreground">{name}</div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
        {primary_format ? <CrateChip>{primary_format.replace(".", "").toUpperCase()}</CrateChip> : null}
        <CrateChip>{albums} {albums === 1 ? "album" : "albums"}</CrateChip>
        <CrateChip>{tracks} tracks</CrateChip>
        <CrateChip>{formatSize(size_mb)}</CrateChip>
      </div>
    </div>
  );
}
