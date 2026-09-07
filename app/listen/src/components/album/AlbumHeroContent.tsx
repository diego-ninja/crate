import type { RefObject } from "react";

import { AlbumHeroCover } from "@/components/album/AlbumHeroCover";
import { AlbumHeroInfo } from "@/components/album/AlbumHeroInfo";
import type { AlbumData, AlbumContributor } from "@/pages/album-types";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { OfflineItemState } from "@/lib/offline";

export function AlbumHeroContent({
  data,
  coverUrl,
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
  coverUrl: string;
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
      data-testid="album-hero-content"
      className="relative mx-auto flex size-full max-w-[1480px] items-end px-4 pb-[calc(var(--album-mobile-action-overlap)+var(--album-mobile-info-action-gap))] pt-[var(--listen-mobile-page-top)] sm:px-6 sm:pb-6 sm:pt-0"
    >
      <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-end">
        <AlbumHeroCover
          data={data}
          coverUrl={coverUrl}
          displayName={displayName}
        />
        <AlbumHeroInfo
          data={data}
          artistPhotoUrl={artistPhotoUrl}
          displayName={displayName}
          isPreRelease={isPreRelease}
          canPersistAlbum={canPersistAlbum}
          offlineState={offlineState}
          year={year}
          genre={genre}
          playerTrackCount={playerTrackCount}
          qualityBadges={qualityBadges}
          visibleContributor={visibleContributor}
          primaryContributorName={primaryContributorName}
          primaryContributorPath={primaryContributorPath}
          primaryContributorSource={primaryContributorSource}
          albumHeroInfoRef={albumHeroInfoRef}
          onArtistNavigate={onArtistNavigate}
          onGenreSelect={onGenreSelect}
          t={t}
        />
      </div>
    </div>
  );
}
