import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import type { ArtistHeroComposition } from "./ArtistHeroFrame";

interface ArtistHeroPresentationProps {
  composition: ArtistHeroComposition;
  kicker: ReactNode;
  artistName: ReactNode;
  intro?: ReactNode;
  genres?: ReactNode;
  actions: ReactNode;
  className?: string;
  copyClassName?: string;
  actionsClassName?: string;
  mobileIntroClassName?: string;
}

export function ArtistHeroPresentation({
  composition,
  kicker,
  artistName,
  intro,
  genres,
  actions,
  className,
  copyClassName,
  actionsClassName,
  mobileIntroClassName,
}: ArtistHeroPresentationProps) {
  const mobile = composition === "mobile";
  const copy = (
    <>
      <p className="text-xs font-semibold uppercase leading-none tracking-[0.3em] text-accent-action sm:text-xs">
        {kicker}
      </p>
      <h1
        data-testid="hero-result-artist-name"
        className={cn(
          "mt-1 max-w-[16ch] text-balance font-black leading-[0.96] tracking-[-0.04em] text-text-primary",
          mobile
            ? "text-4xl min-[390px]:text-5xl"
            : "text-[52px] lg:text-[56px]",
        )}
      >
        {artistName}
      </h1>
      {genres}
      <div className={cn("relative z-30", actionsClassName)}>{actions}</div>
    </>
  );

  return (
    <div
      data-testid={`${composition}-hero-presentation`}
      className={cn(
        "pointer-events-none absolute inset-0 text-text-primary",
        className,
      )}
    >
      {!mobile && intro ? (
        <div className="absolute inset-x-0 top-0">
          <div
            data-testid="desktop-hero-intro-layout"
            className="mx-auto w-full max-w-[1480px] px-6 pt-[92px]"
          >
            {intro}
          </div>
        </div>
      ) : null}

      {mobile && intro ? (
        <div
          data-testid="mobile-hero-intro-layout"
          className={cn(
            "absolute inset-x-0 top-0 px-5",
            mobileIntroClassName ?? "pt-4",
          )}
        >
          {intro}
        </div>
      ) : null}

      {mobile ? (
        <div
          data-testid="mobile-hero-copy-layout"
          className={cn(
            "absolute inset-x-0 bottom-0 px-5 pb-10",
            copyClassName,
          )}
        >
          {copy}
        </div>
      ) : (
        <div
          data-testid="desktop-hero-copy-layer"
          className={cn("absolute inset-x-0 top-[39%]", copyClassName)}
        >
          <div
            data-testid="desktop-hero-content"
            className="mx-auto w-full max-w-[1480px] px-6"
          >
            {copy}
          </div>
        </div>
      )}
    </div>
  );
}
