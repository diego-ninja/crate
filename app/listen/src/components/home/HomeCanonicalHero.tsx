import { useTranslation } from "react-i18next";
import { ArtistHeroFrame } from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistHeroPresentation } from "@crate/ui/domain/ArtistHeroPresentation";
import { ChevronDown, ChevronUp } from "@crate/ui/icons";

import { cn } from "@/lib/utils";

import { HeroActions, HeroBackdrop, HeroGenres } from "./HomeHeroContent";
import { heroArtworkBounds } from "./home-hero-utils";
import type { HomeHeroArtist } from "./home-model";

export function MobileFeaturedArtist({
  hero,
  backgroundSrc,
  following,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  backgroundSrc?: string;
  following: boolean;
  onOpenArtist: () => void;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="relative h-[55dvh] min-h-[430px] max-h-[620px] w-full overflow-hidden bg-surface-canvas">
      <ArtistHeroFrame
        composition="mobile"
        artworkBounds={heroArtworkBounds(hero, "mobile")}
        className="absolute inset-0 h-full"
        artwork={
          <HeroBackdrop
            hero={hero}
            backgroundSrc={backgroundSrc}
            composition="mobile"
            artworkBounds={heroArtworkBounds(hero, "mobile")}
          />
        }
      >
        <button
          type="button"
          aria-label={t("home.hero.openArtist", { name: hero.name })}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={onOpenArtist}
        />
        <ArtistHeroPresentation
          composition="mobile"
          kicker={t("home.hero.featuredArtist")}
          artistName={hero.name}
          genres={<HeroGenres hero={hero} />}
          actions={
            <HeroActions
              hero={hero}
              following={following}
              onPlay={onPlay}
              onToggleFollow={onToggleFollow}
            />
          }
          actionsClassName="pointer-events-auto"
        />
      </ArtistHeroFrame>
    </section>
  );
}

export function DesktopFeaturedArtist({
  hero,
  active,
  backgroundSrc,
  following,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  active: boolean;
  backgroundSrc?: string;
  following: boolean;
  onOpenArtist: () => void;
  onPlay: () => void;
  onToggleFollow: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-opacity",
        active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
      )}
    >
      <ArtistHeroFrame
        composition="desktop"
        artworkBounds={heroArtworkBounds(hero, "desktop")}
        className="h-full"
        artwork={
          <HeroBackdrop
            hero={hero}
            backgroundSrc={backgroundSrc}
            composition="desktop"
            artworkBounds={heroArtworkBounds(hero, "desktop")}
          />
        }
      >
        <button
          type="button"
          aria-label={t("home.hero.openArtist", { name: hero.name })}
          tabIndex={active ? 0 : -1}
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={onOpenArtist}
        />
        <ArtistHeroPresentation
          composition="desktop"
          kicker={t("home.hero.featuredArtist")}
          artistName={hero.name}
          genres={<HeroGenres hero={hero} />}
          actions={
            <HeroActions
              hero={hero}
              following={following}
              onPlay={onPlay}
              onToggleFollow={onToggleFollow}
            />
          }
          actionsClassName="pointer-events-auto"
          copyClassName={cn(
            "transition-opacity duration-500 ease-out motion-reduce:transition-none",
            active ? "opacity-100" : "opacity-0",
          )}
        />
      </ArtistHeroFrame>
    </section>
  );
}

export function DesktopHeroNavigation({
  heroes,
  activeIndex,
  onPrevious,
  onNext,
  onSelect,
}: {
  heroes: HomeHeroArtist[];
  activeIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute right-6 top-[200px] z-30 flex h-[190px] w-8 flex-col items-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        {heroes.map((hero, index) => (
          <button
            key={hero.entity_uid || hero.id}
            type="button"
            aria-label={t("home.hero.showArtist", { name: hero.name })}
            aria-current={index === activeIndex ? "true" : undefined}
            className="group flex h-6 w-8 items-center justify-center rounded-full bg-transparent"
            onClick={() => onSelect(index)}
          >
            <span
              className={cn(
                "block w-1 rounded-full transition-[height,background-color] duration-300",
                index === activeIndex
                  ? "home-hero-pagination-active h-6"
                  : "home-hero-pagination-inactive h-1.5",
              )}
            />
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          aria-label={t("home.hero.previousArtist")}
          className="home-hero-nav-control-plain flex size-8 items-center justify-center border-0 bg-transparent p-0 shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
          onClick={onPrevious}
        >
          <ChevronUp size={20} />
        </button>
        <button
          type="button"
          aria-label={t("home.hero.nextArtist")}
          className="home-hero-nav-control-plain flex size-8 items-center justify-center border-0 bg-transparent p-0 shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
          onClick={onNext}
        >
          <ChevronDown size={20} />
        </button>
      </div>
    </div>
  );
}
