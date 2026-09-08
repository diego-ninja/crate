import { useTranslation } from "react-i18next";
import { Play } from "@crate/ui/icons";

import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { FollowHeartButton } from "@crate/ui/primitives/FollowHeartButton";
import { artistHeroArtworkFitClassName } from "@crate/ui/domain/ArtistHeroFrame";
import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";
import type { ArtistHeroArtworkBounds } from "@crate/ui/domain/ArtistHeroFrame";

import type { HomeHeroArtist } from "./home-model";

export function HeroBackdrop({
  hero,
  backgroundSrc,
  composition,
  artworkBounds,
}: {
  hero: HomeHeroArtist;
  backgroundSrc?: string;
  composition: "desktop" | "mobile";
  artworkBounds?: ArtistHeroArtworkBounds;
}) {
  const grayscale =
    !hero.artwork_revision && hero.artwork_provenance !== "specific";
  if (!backgroundSrc) return null;

  return (
    <CrateImage
      data-testid={`${composition}-hero-artwork`}
      src={backgroundSrc}
      retryPolicy="eventual"
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn(
        "absolute inset-0 h-full w-full transition-opacity duration-500",
        artistHeroArtworkFitClassName(artworkBounds),
        grayscale ? "grayscale" : "",
      )}
    />
  );
}

export function HeroGenres({ hero }: { hero: HomeHeroArtist }) {
  const genres = hero.genre_profile?.length
    ? hero.genre_profile
    : hero.genres?.flatMap((name) => (name ? [{ name }] : [])) ?? [];

  if (genres.length === 0) return null;

  return (
    <div className="mt-4 flex min-w-0 max-w-full flex-wrap gap-1.5 overflow-hidden">
      {genres.slice(0, 2).map((genre) => (
        <GenrePill
          key={genre.name}
          item={genre}
          className="home-hero-genre max-w-[42vw] backdrop-blur-sm sm:max-w-none"
        />
      ))}
    </div>
  );
}

export function HeroActions({
  hero,
  following,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  following: boolean;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();

  const playLabel = t("home.hero.playArtist", { name: hero.name });
  const followLabel = t(
    following ? "actions.artist.unfollowNamed" : "actions.artist.followNamed",
    { name: hero.name },
  );

  return (
    <div className="mt-6 flex items-center gap-2.5">
      <button
        type="button"
        aria-label={playLabel}
        className={cn(
          "home-discovery-play-button inline-flex h-11 items-center justify-center gap-2 rounded-md font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90",
          "px-5",
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onPlay();
        }}
      >
        <Play size={17} fill="currentColor" />
        <span>{t("home.hero.playCta")}</span>
      </button>
      <FollowHeartButton
        aria-label={followLabel}
        className="home-hero-follow inline-flex size-11 items-center justify-center rounded-md border-0 bg-transparent transition-colors hover:bg-transparent"
        following={following}
        heartTestId="hero-follow-heart"
        particlesTestId="hero-follow-particles"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleFollow();
        }}
      />
    </div>
  );
}
