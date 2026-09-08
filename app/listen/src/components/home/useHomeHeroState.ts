import { useEffect, useMemo, useRef, useState } from "react";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { preloadArtwork } from "@/lib/artwork-manager";
import { artworkFromUrl } from "@/lib/artwork-source";

import type { HomeDiscoveryHeroSurfaces, HomeHeroArtist } from "./home-model";
import {
  dedupeHeroArtists,
  heroBackgroundSrc,
  heroSelectionKey,
  homeHeroArtworkLogicalKey,
  legacyHeroBackgroundSrc,
  requestBackgroundWork,
} from "./home-hero-utils";

export function useHeroBackgroundPreloader(
  heroes: HomeHeroArtist[],
  activeIndex: number,
  composition: "desktop" | "mobile",
  mode: "canonical" | "legacy",
): void {
  const sources = useMemo(
    () =>
      heroes.flatMap((hero) => {
        const source =
          mode === "canonical"
            ? heroBackgroundSrc(hero, composition)
            : legacyHeroBackgroundSrc(hero, composition);
        return source ? [source] : [];
      }),
    [composition, heroes, mode],
  );
  const readyRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const allowed = new Set(sources);
    readyRef.current = new Set(
      [...readyRef.current].filter((src) => allowed.has(src)),
    );
    inFlightRef.current = new Set(
      [...inFlightRef.current].filter((src) => allowed.has(src)),
    );
  }, [sources]);

  useEffect(() => {
    if (!sources.length || typeof window === "undefined") return;

    let cancelled = false;
    const controller = new AbortController();
    const started = new Set<string>();
    const timeouts: number[] = [];

    const markReady = (src: string) => {
      readyRef.current.add(src);
    };

    const loadSource = (src: string | undefined, priority: "high" | "low") => {
      if (!src || readyRef.current.has(src) || inFlightRef.current.has(src))
        return;
      inFlightRef.current.add(src);
      started.add(src);
      void preloadArtwork(
        artworkFromUrl(src, {
          logicalKey: homeHeroArtworkLogicalKey(src),
        }),
        { fetchPriority: priority, signal: controller.signal },
      )
        .then(() => {
          if (!cancelled) markReady(src);
        })
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current.delete(src);
        });
    };

    const current =
      sources[Math.max(0, Math.min(activeIndex, sources.length - 1))];
    const next =
      sources.length > 1
        ? sources[(activeIndex + 1) % sources.length]
        : undefined;
    const immediate = new Set(
      [current, next].filter((src): src is string => Boolean(src)),
    );

    immediate.forEach((src) => loadSource(src, "high"));

    const cancelBackgroundWork = requestBackgroundWork(() => {
      let backgroundIndex = 0;
      sources.forEach((src) => {
        if (immediate.has(src)) return;
        const timeout = window.setTimeout(() => {
          if (!cancelled) loadSource(src, "low");
        }, backgroundIndex++ * 220);
        timeouts.push(timeout);
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelBackgroundWork();
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
      started.forEach((src) => inFlightRef.current.delete(src));
    };
  }, [activeIndex, sources]);
}

export function useHeroSurface(
  heroes: HomeHeroArtist[],
  heroSurfaces?: HomeDiscoveryHeroSurfaces | null,
) {
  const isDesktop = useIsDesktop();
  const composition: "desktop" | "mobile" = isDesktop ? "desktop" : "mobile";
  const surface = heroSurfaces?.[composition];
  const mode = surface?.mode ?? "canonical";
  const surfaceArtists = surface?.artists ?? heroes;
  const surfaceHeroes = useMemo(
    () => dedupeHeroArtists(surfaceArtists),
    [surfaceArtists],
  );
  return { composition, isDesktop, mode, surfaceHeroes };
}

export function useDesktopHeroSelection(count: number, isDesktop: boolean) {
  const [idx, setIdx] = useState(() =>
    isDesktop && count > 1 ? Math.floor(Math.random() * count) : 0,
  );
  const initialIndexSet = useRef(isDesktop && count > 1);

  useEffect(() => {
    setIdx((current) => Math.min(current, Math.max(count - 1, 0)));
  }, [count]);

  useEffect(() => {
    if (!isDesktop || count <= 1 || initialIndexSet.current) return;
    initialIndexSet.current = true;
    setIdx(Math.floor(Math.random() * count));
  }, [count, isDesktop]);

  return {
    activeIndex: Math.min(idx, Math.max(count - 1, 0)),
    setIndex: setIdx,
  };
}

export function useMobileHeroSelection(
  surfaceHeroes: HomeHeroArtist[],
  count: number,
  isDesktop: boolean,
) {
  const [mobileHeroKey, setMobileHeroKey] = useState<string | null>(() => {
    if (isDesktop || !count) return null;
    return heroSelectionKey(
      surfaceHeroes[Math.floor(Math.random() * count)] || surfaceHeroes[0]!,
    );
  });

  useEffect(() => {
    if (isDesktop || !count) return;
    setMobileHeroKey((current) => {
      if (
        current &&
        surfaceHeroes.some((hero) => heroSelectionKey(hero) === current)
      ) {
        return current;
      }
      return heroSelectionKey(
        surfaceHeroes[Math.floor(Math.random() * count)] || surfaceHeroes[0]!,
      );
    });
  }, [count, isDesktop, surfaceHeroes]);

  return surfaceHeroes.find((hero) => heroSelectionKey(hero) === mobileHeroKey);
}
