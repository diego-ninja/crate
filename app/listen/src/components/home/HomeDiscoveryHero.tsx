import { type ReactNode } from "react";

import type { HomeDiscoveryHeroSurfaces, HomeHeroArtist } from "./home-model";
import { heroBackgroundSrc, legacyHeroBackgroundSrc } from "./home-hero-utils";
import {
  DesktopFeaturedArtist,
  DesktopHeroNavigation,
  MobileFeaturedArtist,
} from "./HomeCanonicalHero";
import {
  LegacyDesktopFeaturedArtist,
  LegacyDesktopHeroNavigation,
  LegacyMobileFeaturedArtist,
} from "./HomeLegacyHero";
import {
  useDesktopHeroSelection,
  useHeroBackgroundPreloader,
  useHeroSurface,
  useMobileHeroSelection,
} from "./useHomeHeroState";

interface HomeTasteHeroProps {
  heroes: HomeHeroArtist[];
  heroSurfaces?: HomeDiscoveryHeroSurfaces | null;
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  desktopIntro?: ReactNode;
}

function MobileTasteHero({
  hero,
  mode,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
}: {
  hero: HomeHeroArtist;
  mode: "canonical" | "legacy";
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
}) {
  const props = {
    hero,
    backgroundSrc:
      mode === "canonical"
        ? heroBackgroundSrc(hero, "mobile")
        : legacyHeroBackgroundSrc(hero, "mobile"),
    following: isFollowing(hero.id),
    onOpenArtist: () => onOpenArtist(hero),
    onPlay: () => onPlay(hero),
    onToggleFollow: () => onToggleFollow(hero),
  };

  return mode === "legacy" ? (
    <LegacyMobileFeaturedArtist {...props} />
  ) : (
    <MobileFeaturedArtist {...props} />
  );
}

function DesktopTasteHero({
  heroes,
  activeIndex,
  mode,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  onPrevious,
  onNext,
  onSelect,
  desktopIntro,
}: {
  heroes: HomeHeroArtist[];
  activeIndex: number;
  mode: "canonical" | "legacy";
  isFollowing: (id?: number) => boolean;
  onOpenArtist: (artist: HomeHeroArtist) => void;
  onPlay: (artist: HomeHeroArtist) => void;
  onToggleFollow: (artist: HomeHeroArtist) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  desktopIntro?: ReactNode;
}) {
  const count = heroes.length;

  return (
    <div
      data-testid="desktop-editorial-hero"
      className="relative mx-auto aspect-[1480/600] min-h-[clamp(480px,38dvh,600px)] w-full max-w-[1480px] overflow-hidden bg-surface-canvas"
    >
      {heroes.map((hero, index) => {
        const source =
          mode === "canonical"
            ? heroBackgroundSrc(hero, "desktop")
            : legacyHeroBackgroundSrc(hero, "desktop");
        const isPrepared =
          index === activeIndex ||
          index === (activeIndex + 1) % count ||
          index === (activeIndex - 1 + count) % count;
        const heroProps = {
          key: hero.entity_uid || hero.id,
          hero,
          active: index === activeIndex,
          backgroundSrc: isPrepared ? source : undefined,
          following: isFollowing(hero.id),
          onOpenArtist: () => onOpenArtist(hero),
          onPlay: () => onPlay(hero),
          onToggleFollow: () => onToggleFollow(hero),
        };
        return mode === "canonical" ? (
          <DesktopFeaturedArtist {...heroProps} />
        ) : (
          <LegacyDesktopFeaturedArtist {...heroProps} />
        );
      })}

      {count > 1 ? (
        mode === "canonical" ? (
          <DesktopHeroNavigation
            heroes={heroes}
            activeIndex={activeIndex}
            onPrevious={onPrevious}
            onNext={onNext}
            onSelect={onSelect}
          />
        ) : (
          <LegacyDesktopHeroNavigation
            heroes={heroes}
            activeIndex={activeIndex}
            onPrevious={onPrevious}
            onNext={onNext}
            onSelect={onSelect}
          />
        )
      ) : null}

      {mode === "canonical" && desktopIntro ? (
        <div
          data-testid="desktop-hero-intro"
          className="pointer-events-none absolute inset-x-0 top-0 z-20"
        >
          <div className="mx-auto w-full max-w-[1480px] px-6 pt-[92px]">
            {desktopIntro}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function HomeTasteHero({
  heroes,
  heroSurfaces,
  isFollowing,
  onOpenArtist,
  onPlay,
  onToggleFollow,
  desktopIntro,
}: HomeTasteHeroProps) {
  const { composition, isDesktop, mode, surfaceHeroes } = useHeroSurface(
    heroes,
    heroSurfaces,
  );
  const count = surfaceHeroes.length;
  const desktopSelection = useDesktopHeroSelection(count, isDesktop);
  const mobileHero = useMobileHeroSelection(surfaceHeroes, count, isDesktop);
  const activeIndex = isDesktop
    ? desktopSelection.activeIndex
    : Math.max(0, mobileHero ? surfaceHeroes.indexOf(mobileHero) : 0);
  useHeroBackgroundPreloader(surfaceHeroes, activeIndex, composition, mode);

  if (!count) return null;
  if (!isDesktop) {
    const hero = mobileHero || surfaceHeroes[0];
    return hero ? (
      <MobileTasteHero
        hero={hero}
        mode={mode}
        isFollowing={isFollowing}
        onOpenArtist={onOpenArtist}
        onPlay={onPlay}
        onToggleFollow={onToggleFollow}
      />
    ) : null;
  }

  return (
    <DesktopTasteHero
      heroes={surfaceHeroes}
      activeIndex={desktopSelection.activeIndex}
      mode={mode}
      isFollowing={isFollowing}
      onOpenArtist={onOpenArtist}
      onPlay={onPlay}
      onToggleFollow={onToggleFollow}
      onPrevious={() =>
        desktopSelection.setIndex((current) => (current - 1 + count) % count)
      }
      onNext={() =>
        desktopSelection.setIndex((current) => (current + 1) % count)
      }
      onSelect={desktopSelection.setIndex}
      desktopIntro={desktopIntro}
    />
  );
}
