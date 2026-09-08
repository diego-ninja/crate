import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../lib/cn";

export type ArtistHeroComposition = "desktop" | "mobile";

export const ARTIST_HERO_DESKTOP_SIZE = { width: 1480, height: 600 } as const;
export const ARTIST_HERO_MOBILE_SIZE = { width: 1080, height: 1350 } as const;

export const ARTIST_HERO_BASE_BACKGROUND = "var(--surface-app)";

export interface ArtistHeroArtworkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function artistHeroArtworkFitClassName(
  artworkBounds?: ArtistHeroArtworkBounds,
) {
  const usesExtendedCanvas =
    artworkBounds &&
    (artworkBounds.left !== 0 ||
      artworkBounds.top !== 0 ||
      artworkBounds.right !== 1 ||
      artworkBounds.bottom !== 1);

  return usesExtendedCanvas ? "object-fill" : "object-cover object-center";
}

const LEFT_EDGE_FADE = `linear-gradient(
  to right,
  var(--surface-app) 0%,
  color-mix(in srgb, var(--surface-app) 96%, transparent) 8%,
  color-mix(in srgb, var(--surface-app) 82%, transparent) 20%,
  color-mix(in srgb, var(--surface-app) 58%, transparent) 36%,
  color-mix(in srgb, var(--surface-app) 34%, transparent) 54%,
  color-mix(in srgb, var(--surface-app) 14%, transparent) 72%,
  color-mix(in srgb, var(--surface-app) 4%, transparent) 88%,
  transparent 100%
)`;

const RIGHT_EDGE_FADE = `linear-gradient(
  to left,
  var(--surface-app) 0%,
  color-mix(in srgb, var(--surface-app) 96%, transparent) 8%,
  color-mix(in srgb, var(--surface-app) 82%, transparent) 20%,
  color-mix(in srgb, var(--surface-app) 58%, transparent) 36%,
  color-mix(in srgb, var(--surface-app) 34%, transparent) 54%,
  color-mix(in srgb, var(--surface-app) 14%, transparent) 72%,
  color-mix(in srgb, var(--surface-app) 4%, transparent) 88%,
  transparent 100%
)`;
const RIGHT_EDGE_OVERLAP = 2;

const BOTTOM_FADE = `linear-gradient(
  to top,
  var(--surface-app) 0%,
  var(--surface-app) 16%,
  color-mix(in srgb, var(--surface-app) 96%, transparent) 25%,
  color-mix(in srgb, var(--surface-app) 78%, transparent) 40%,
  color-mix(in srgb, var(--surface-app) 48%, transparent) 58%,
  color-mix(in srgb, var(--surface-app) 20%, transparent) 77%,
  color-mix(in srgb, var(--surface-app) 7%, transparent) 90%,
  transparent 100%
)`;

interface ArtistHeroFrameProps extends ComponentPropsWithoutRef<"div"> {
  composition: ArtistHeroComposition;
  artwork: ReactNode;
  artworkBounds?: ArtistHeroArtworkBounds;
  aspectRatio?: string | number;
  contentClassName?: string;
}

function clampToFrame(value: number) {
  return Math.min(1, Math.max(0, value));
}

function percentage(value: number) {
  return `${Math.round(value * 10_000) / 100}%`;
}

export function ArtistHeroFrame({
  composition,
  artwork,
  artworkBounds,
  aspectRatio,
  children,
  contentClassName,
  className,
  style,
  ...props
}: ArtistHeroFrameProps) {
  const mobile = composition === "mobile";
  const leftEdge = clampToFrame(artworkBounds?.left ?? 0);
  const rightEdge = clampToFrame(artworkBounds?.right ?? 1);
  const bottomEdge = clampToFrame(artworkBounds?.bottom ?? 1);
  const rightFadeWidth = Math.min(0.48, rightEdge);
  const rightFadeRight = percentage(1 - rightEdge);
  const rightFadeWidthStyle = artworkBounds
    ? `calc(${percentage(rightFadeWidth)} + ${RIGHT_EDGE_OVERLAP}px)`
    : percentage(rightFadeWidth);
  const rightFadeRightStyle = artworkBounds
    ? `calc(${rightFadeRight} - ${RIGHT_EDGE_OVERLAP}px)`
    : rightFadeRight;

  return (
    <div
      {...props}
      data-testid={`${composition}-artist-hero-frame`}
      className={cn(
        "relative w-full overflow-hidden bg-surface-canvas",
        className,
      )}
      style={{
        ...style,
        aspectRatio: aspectRatio ?? (mobile ? "4 / 5" : "1480 / 600"),
      }}
    >
      <div
        data-testid={`${composition}-hero-base`}
        className="absolute inset-0"
        style={{ background: ARTIST_HERO_BASE_BACKGROUND }}
      />
      <div
        data-testid={`${composition}-hero-artwork-mask`}
        className="absolute inset-0"
        style={{ maskImage: "none", WebkitMaskImage: "none" }}
      >
        {artwork}
      </div>

      {mobile ? (
        <div
          data-testid="mobile-hero-scrim"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[82%]"
          style={{
            background: BOTTOM_FADE,
            bottom: percentage(1 - bottomEdge),
          }}
        />
      ) : (
        <>
          <div
            data-testid="desktop-hero-left-edge-scrim"
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{
              background: LEFT_EDGE_FADE,
              left: percentage(leftEdge),
              width: percentage(Math.min(0.34, 1 - leftEdge)),
            }}
          />
          <div
            data-testid="desktop-hero-right-scrim"
            className="pointer-events-none absolute inset-y-0 z-10"
            style={{
              background: RIGHT_EDGE_FADE,
              right: rightFadeRightStyle,
              width: rightFadeWidthStyle,
            }}
          />
          <div
            data-testid="desktop-hero-bottom-scrim"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[58%]"
            style={{
              background: BOTTOM_FADE,
              bottom: percentage(1 - bottomEdge),
            }}
          />
        </>
      )}

      {children ? (
        <div
          data-testid={`${composition}-hero-overlay-host`}
          className={cn("absolute inset-0 z-20", contentClassName)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
