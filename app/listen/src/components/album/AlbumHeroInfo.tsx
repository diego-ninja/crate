import type { RefObject } from "react";

import { AlbumHeroContributor } from "@/components/album/AlbumHeroContributor";
import { AlbumHeroDetails } from "@/components/album/AlbumHeroDetails";
import { AlbumHeroFacts } from "@/components/album/AlbumHeroFacts";
import type { AlbumData, AlbumContributor } from "@/pages/album-types";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { OfflineItemState } from "@/lib/offline";

export function AlbumHeroInfo({
  data,
  artistPhotoUrl,
  displayName,
  isPreRelease,
  canPersistAlbum,
  offlineState,
  year,
  genre,
  playerTrackCount,
  qualityBadges,
  visibleContributor,
  primaryContributorName,
  primaryContributorPath,
  primaryContributorSource,
  albumHeroInfoRef,
  onArtistNavigate,
  onGenreSelect,
  t,
}: {
  data: AlbumData;
  artistPhotoUrl: string;
  displayName: string;
  isPreRelease: boolean;
  canPersistAlbum: boolean;
  offlineState: OfflineItemState;
  year?: string;
  genre?: string;
  playerTrackCount: number;
  qualityBadges: QualityBadgeData[];
  visibleContributor: AlbumContributor | null;
  primaryContributorName: string | null;
  primaryContributorPath: string | null;
  primaryContributorSource: string | null;
  albumHeroInfoRef: RefObject<HTMLDivElement | null>;
  onArtistNavigate: () => void;
  onGenreSelect: (item: GenreProfileItem) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div
      ref={albumHeroInfoRef}
      data-testid="album-hero-info"
      className="flex min-w-0 translate-y-[var(--album-mobile-info-y)] flex-col justify-end text-left sm:translate-y-0"
    >
      <AlbumHeroDetails
        data={data}
        artistPhotoUrl={artistPhotoUrl}
        displayName={displayName}
        isPreRelease={isPreRelease}
        canPersistAlbum={canPersistAlbum}
        offlineState={offlineState}
        onArtistNavigate={onArtistNavigate}
      />
      <AlbumHeroFacts
        data={data}
        isPreRelease={isPreRelease}
        year={year}
        genre={genre}
        playerTrackCount={playerTrackCount}
        qualityBadges={qualityBadges}
        t={t}
      />
      <AlbumHeroContributor
        data={data}
        visibleContributor={visibleContributor}
        primaryContributorName={primaryContributorName}
        primaryContributorPath={primaryContributorPath}
        primaryContributorSource={primaryContributorSource}
        onGenreSelect={onGenreSelect}
      />
    </div>
  );
}
