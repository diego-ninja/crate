import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

import { HeroActions, HeroGenres } from "./HomeHeroContent";
import type { HomeHeroArtist } from "./home-model";

export function LegacyMobileFeaturedArtist({
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
    <section
      data-testid="mobile-legacy-hero"
      className="home-legacy-hero relative h-[55dvh] min-h-[430px] max-h-[620px] w-full overflow-hidden rounded-none border-y border-border-quiet"
    >
      <LegacyHeroArtwork backgroundSrc={backgroundSrc} composition="mobile" />
      <button
        type="button"
        aria-label={t("home.hero.openArtist", { name: hero.name })}
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={onOpenArtist}
      />
      <div className="pointer-events-none relative z-20 flex h-full flex-col justify-end px-6 py-8">
        <LegacyHeroCopy
          hero={hero}
          following={following}
          onPlay={onPlay}
          onToggleFollow={onToggleFollow}
        />
      </div>
    </section>
  );
}

export function LegacyDesktopFeaturedArtist({
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
      data-testid="desktop-legacy-hero"
      aria-hidden={!active}
      className={cn(
        "home-legacy-hero absolute inset-0 overflow-hidden rounded-[12px] border border-border-quiet transition-opacity duration-500 ease-out",
        active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0",
      )}
    >
      <LegacyHeroArtwork backgroundSrc={backgroundSrc} composition="desktop" />
      <button
        type="button"
        aria-label={t("home.hero.openArtist", { name: hero.name })}
        tabIndex={active ? 0 : -1}
        className="absolute inset-0 z-10 cursor-pointer"
        onClick={onOpenArtist}
      />
      <div className="pointer-events-none relative z-20 flex h-full flex-col justify-end p-10 ">
        <div className="max-w-[44%]">
          <LegacyHeroCopy
            hero={hero}
            following={following}
            onPlay={onPlay}
            onToggleFollow={onToggleFollow}
          />
        </div>
      </div>
    </section>
  );
}

function LegacyHeroArtwork({
  backgroundSrc,
  composition,
}: {
  backgroundSrc?: string;
  composition: "desktop" | "mobile";
}) {
  return (
    <>
      {backgroundSrc ? (
        <CrateImage
          data-testid={`${composition}-legacy-hero-artwork`}
          src={backgroundSrc}
          retryPolicy="eventual"
          alt=""
          aria-hidden="true"
          decoding="async"
          className="pointer-events-none absolute inset-0 size-full object-cover object-top"
        />
      ) : null}
      <div className="home-hero-scrim-horizontal pointer-events-none absolute inset-0" />
      <div className="home-hero-scrim-vertical pointer-events-none absolute inset-0" />
    </>
  );
}

function LegacyHeroCopy({
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
  return (
    <div className="pointer-events-auto">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent-action">
        {t("home.library.justLanded.title")}
      </p>
      <h1 className="home-hero-title mt-2 truncate text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
        {hero.name}
      </h1>
      <HeroGenres hero={hero} />
      <HeroActions
        hero={hero}
        following={following}
        onPlay={onPlay}
        onToggleFollow={onToggleFollow}
      />
    </div>
  );
}

export function LegacyDesktopHeroNavigation({
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
    <div className="absolute inset-x-0 bottom-5 z-30 flex items-center justify-center gap-3">
      <button
        type="button"
        aria-label={t("home.hero.previousArtist")}
        className="home-hero-nav-control flex size-9 items-center justify-center rounded-full backdrop-blur-sm"
        onClick={onPrevious}
      >
        <ChevronLeft size={18} />
      </button>
      <div className="flex items-center gap-1.5">
        {heroes.map((hero, index) => (
          <button
            key={hero.entity_uid || hero.id}
            type="button"
            aria-label={t("home.hero.showArtist", { name: hero.name })}
            aria-current={index === activeIndex ? "true" : undefined}
            className="flex h-6 items-center bg-transparent px-1"
            onClick={() => onSelect(index)}
          >
            <span
              className={cn(
                "block h-1.5 rounded-full transition-all duration-300",
                index === activeIndex
                  ? "home-hero-pagination-active w-6"
                  : "home-hero-pagination-inactive w-1.5",
              )}
            />
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label={t("home.hero.nextArtist")}
        className="home-hero-nav-control flex size-9 items-center justify-center rounded-full backdrop-blur-sm"
        onClick={onNext}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
