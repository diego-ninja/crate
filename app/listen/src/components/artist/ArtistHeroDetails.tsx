import { useTranslation } from "react-i18next";

import { ChevronDown, Users } from "@crate/ui/icons";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";

import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import { formatCompact } from "@/lib/utils";

interface ArtistHeroDetailsProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  onOpenBio: () => void;
}

export function ArtistHeroDetails({
  artist,
  artistInfo,
  onOpenBio,
}: ArtistHeroDetailsProps) {
  const { t } = useTranslation();
  const bio = artistInfo?.bio ?? "";

  return (
    <div className="max-w-3xl pb-1">
      <h1 className="mb-1 text-3xl font-bold text-text-primary sm:mb-2 sm:text-4xl">
        {artist.name}
      </h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
        {artistInfo?.listeners ? (
          <span className="flex items-center gap-1">
            <Users size={14} />
            {t("artist.meta.listeners", {
              count: formatCompact(artistInfo.listeners),
            })}
          </span>
        ) : null}
        {artist.total_tracks > 0 ? (
          <span>
            {t("common.trackCountLabel", {
              count: artist.total_tracks,
            })}
          </span>
        ) : null}
        {artist.albums.length > 0 ? (
          <span>
            {t("common.albumCountLabel", {
              count: artist.albums.length,
            })}
          </span>
        ) : null}
      </div>

      {bio ? (
        <div className="mt-3 max-w-2xl">
          <p className="line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-text-primary/70 sm:line-clamp-3">
            <ArtistBioText text={bio} />
          </p>
          {bio.length > 200 ? (
            <button
              type="button"
              className="mt-2 flex items-center gap-1 text-xs text-accent-action hover:underline"
              onClick={onOpenBio}
            >
              {t("common.showMore")} <ChevronDown size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
