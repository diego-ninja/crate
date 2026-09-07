import type { CSSProperties } from "react";

import type { Track } from "@/contexts/player-types";
import type { TrackInfo } from "@/lib/track-info";

import { InfoTabHeroArtwork } from "./InfoTabHeroArtwork";
import { InfoTabHeroIdentity } from "./InfoTabHeroIdentity";
import { InfoTabHeroRating } from "./InfoTabHeroRating";
import { InfoTabHeroStats } from "./InfoTabHeroStats";
import type { PaletteTriplet } from "./info-tab-data";
import { cssColor } from "./info-tab-data";

export function InfoTabHero({
  info,
  currentTrack,
  audioSummary,
  qualityPills,
  palette,
}: {
  info: TrackInfo;
  currentTrack: Track;
  audioSummary: string[];
  qualityPills: string[];
  palette: {
    primary: PaletteTriplet;
    secondary: PaletteTriplet;
    accent: PaletteTriplet;
  };
}) {
  const albumName = info.album || currentTrack.album;

  return (
    <section
      className="info-tab-hero relative overflow-hidden rounded-[12px] p-4 sm:px-5"
      style={
        {
          "--info-tab-palette-primary": cssColor(palette.primary),
          "--info-tab-palette-secondary": cssColor(palette.secondary),
          "--info-tab-palette-accent": cssColor(palette.accent),
        } as CSSProperties
      }
    >
      <div className="info-tab-hero-secondary pointer-events-none absolute -top-16 -right-12 size-40 rounded-full blur-3xl" />
      <div className="info-tab-hero-accent pointer-events-none absolute -bottom-12 left-0 size-32 rounded-full blur-3xl" />

      <div className="relative flex items-start gap-4">
        <InfoTabHeroArtwork currentTrack={currentTrack} albumName={albumName} />
        <InfoTabHeroIdentity
          info={info}
          currentTrack={currentTrack}
          audioSummary={audioSummary}
        />
        <InfoTabHeroRating rating={info.rating} />
      </div>

      <InfoTabHeroStats info={info} qualityPills={qualityPills} />
      <InfoTabHeroRating rating={info.rating} mobile />
    </section>
  );
}
