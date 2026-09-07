import { CrateImage } from "@/components/artwork/CrateImage";
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

  return (
    <div className="relative h-[420px] overflow-hidden sm:h-[400px]">
      {photoUrl ? (
        <CrateImage
          src={photoUrl}
          alt=""
          className="absolute inset-0 size-full scale-[1.02] object-cover object-[right_20%] brightness-[0.72] contrast-110 opacity-[0.82] sm:hidden"
        />
      ) : heroBackgroundSrc ? (
        <CrateImage
          src={heroBackgroundSrc}
          alt=""
          className="absolute inset-0 size-full scale-[1.02] object-cover object-[right_20%] brightness-[0.72] contrast-110 opacity-[0.82] sm:hidden"
        />
      ) : null}
      {heroBackgroundSrc ? (
        <CrateImage
          src={heroBackgroundSrc}
          alt=""
          className="absolute inset-0 size-full scale-[1.02] object-cover object-[right_20%] grayscale brightness-[0.5] contrast-110 opacity-[0.45] hidden sm:block"
        />
      ) : null}
      <div className="absolute inset-0 bg-surface-canvas/10 sm:bg-surface-canvas/32" />
      <div
        className="absolute inset-0 sm:hidden"
        data-testid="artist-hero-mobile-gradient"
        style={{ background: "var(--hero-artwork-gradient-mobile)" }}
      />
      <div
        className="absolute inset-0 hidden sm:block"
        data-testid="artist-hero-desktop-gradient"
        style={{ background: "var(--hero-artwork-gradient-desktop)" }}
      />
      <div className="relative mx-auto flex size-full max-w-[1480px] items-end px-4 pb-6 sm:px-6">
        <div className="flex w-full flex-col gap-5 sm:flex-row sm:items-end">
          <div className="hidden size-40 shrink-0 overflow-hidden rounded-full bg-text-primary/5 shadow-2xl ring-2 ring-text-primary/10 sm:block">
            <CrateImage
              src={photoUrl}
              alt={artist.name}
              className=" size-full object-cover"
            />
          </div>
          <ArtistHeroDetails
            artist={artist}
            artistInfo={artistInfo}
            onOpenBio={onOpenBio}
          />
        </div>
      </div>
    </div>
  );
}
