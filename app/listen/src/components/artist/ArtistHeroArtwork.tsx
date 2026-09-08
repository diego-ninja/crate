import { CrateImage } from "@/components/artwork/CrateImage";
import {
  ArtistHeroFrame,
  artistHeroArtworkFitClassName,
} from "@crate/ui/domain/ArtistHeroFrame";
import {
  type ArtistData,
  type ArtistInfo,
} from "@/components/artist/artist-model";
import { ArtistHeroDetails } from "@/components/artist/ArtistHeroDetails";

interface ArtistHeroArtworkProps {
  artist: ArtistData;
  artistInfo?: ArtistInfo;
  photoUrl: string;
  backgroundUrl?: string;
  onOpenBio: () => void;
}

function withHeroCacheBust(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}v=artist-hero-bg-v1`;
}

export function ArtistHeroArtwork({
  artist,
  artistInfo,
  photoUrl,
  backgroundUrl,
  onOpenBio,
}: ArtistHeroArtworkProps) {
  const heroBackgroundSrc = backgroundUrl
    ? withHeroCacheBust(backgroundUrl)
    : undefined;

  const renderContent = (showArtistPhoto: boolean) => (
    <div className="mx-auto flex size-full max-w-[1480px] items-end px-4 pb-6 sm:px-6">
      <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
        {showArtistPhoto ? (
          <div className="size-40 shrink-0 overflow-hidden rounded-full bg-text-primary/5 shadow-2xl ring-2 ring-text-primary/10">
            <CrateImage
              src={photoUrl}
              alt={artist.name}
              className="size-full object-cover"
            />
          </div>
        ) : null}
        <ArtistHeroDetails
          artist={artist}
          artistInfo={artistInfo}
          onOpenBio={onOpenBio}
        />
      </div>
    </div>
  );

  const mobileArtwork = photoUrl ? photoUrl : heroBackgroundSrc;

  return (
    <div className="relative h-[420px] overflow-hidden sm:h-[400px]">
      <div className="h-full sm:hidden">
        <ArtistHeroFrame
          composition="mobile"
          aspectRatio="auto"
          className="h-full"
          artwork={
            mobileArtwork ? (
              <CrateImage
                src={mobileArtwork}
                alt=""
                className={`absolute inset-0 size-full scale-[1.02] ${artistHeroArtworkFitClassName()} object-[right_20%] brightness-[0.72] contrast-110 opacity-[0.82]`}
              />
            ) : null
          }
        >
          {renderContent(false)}
        </ArtistHeroFrame>
      </div>
      <div className="hidden h-full sm:block">
        <ArtistHeroFrame
          composition="desktop"
          aspectRatio="auto"
          className="h-full"
          artwork={
            heroBackgroundSrc ? (
              <CrateImage
                src={heroBackgroundSrc}
                alt=""
                className={`absolute inset-0 size-full scale-[1.02] ${artistHeroArtworkFitClassName()} object-[right_20%] grayscale brightness-[0.5] contrast-110 opacity-[0.45]`}
              />
            ) : null
          }
        >
          {renderContent(true)}
        </ArtistHeroFrame>
      </div>
    </div>
  );
}
