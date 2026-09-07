import type { RefObject } from "react";

import { AlbumHeroContent } from "@/components/album/AlbumHeroContent";
import { CrateImage } from "@/components/artwork/CrateImage";
import type { AlbumData, AlbumContributor } from "@/pages/album-types";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";
import type { QualityBadge as QualityBadgeData } from "@/components/player/bar/player-bar-utils";
import type { OfflineItemState } from "@/lib/offline";

export function AlbumHero({
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
    <div className="relative min-h-[520px] overflow-hidden sm:h-[430px] sm:min-h-0 lg:h-[460px]">
      {data.has_cover || data.cover_url ? (
        <CrateImage
          data-testid="album-hero-background"
          src={coverUrl}
          alt=""
          className="absolute inset-0 size-full scale-[1.04] object-cover brightness-[0.72] contrast-110 opacity-[0.82] sm:grayscale sm:brightness-[0.42] sm:opacity-[0.42]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="absolute inset-0 bg-surface-canvas/10 sm:bg-surface-canvas/32" />
      <div
        className="absolute inset-0 sm:hidden"
        data-testid="album-hero-mobile-gradient"
        style={{ background: "var(--hero-artwork-gradient-mobile)" }}
      />
      <div
        className="absolute inset-0 hidden sm:block"
        data-testid="album-hero-desktop-gradient"
        style={{ background: "var(--hero-artwork-gradient-desktop)" }}
      />
      <AlbumHeroContent
        data={data}
        coverUrl={coverUrl}
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
  );
}
