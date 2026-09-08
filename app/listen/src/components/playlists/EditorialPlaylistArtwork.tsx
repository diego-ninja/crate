import { PlaylistArtwork, type PlaylistArtworkTrack } from "./PlaylistArtwork";

import { CrateImage } from "@/components/artwork/CrateImage";
import { cn } from "@/lib/utils";

type EditorialVariant = "core" | "history" | "crate";

interface EditorialPlaylistArtworkProps {
  title: string;
  kicker?: string;
  tracks?: PlaylistArtworkTrack[];
  coverDataUrl?: string | null;
  backgroundImageUrl?: string | null;
  variant?: EditorialVariant;
  className?: string;
  textClassName?: string;
}

const VARIANT_TONES: Record<EditorialVariant, string> = {
  core: "from-accent-action/28 via-surface-canvas/12 to-surface-canvas",
  history: "from-accent-action/24 via-surface-canvas/10 to-surface-canvas",
  crate: "from-state-info/22 via-surface-canvas/12 to-surface-canvas",
};

const VARIANT_RADIALS: Record<EditorialVariant, string> = {
  core: "editorial-playlist-radial-core",
  history: "editorial-playlist-radial-history",
  crate: "editorial-playlist-radial-crate",
};

const EMPTY_TRACKS: PlaylistArtworkTrack[] = [];

export function editorialPlaylistLabel(
  name: string,
  fallbackKicker = "Core Tracks",
): { title: string; kicker: string } {
  const cleaned = name.trim();
  const coreMatch = cleaned.match(/\s+core\s+tracks$/i);
  const mixMatch = cleaned.match(/\s+mix$/i);

  if (coreMatch) {
    return {
      title: cleaned.slice(0, coreMatch.index).trim() || cleaned,
      kicker: "Core Tracks",
    };
  }

  if (mixMatch && fallbackKicker === "Core Tracks") {
    return {
      title: cleaned.slice(0, mixMatch.index).trim() || cleaned,
      kicker: fallbackKicker,
    };
  }

  return { title: cleaned || "Crate", kicker: fallbackKicker };
}

export function EditorialPlaylistArtwork({
  title,
  kicker = "Core Tracks",
  tracks = EMPTY_TRACKS,
  coverDataUrl,
  backgroundImageUrl,
  variant = "core",
  className,
  textClassName,
}: EditorialPlaylistArtworkProps) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-[3px] border border-border-quiet bg-surface-canvas [container-type:inline-size]",
        className,
      )}
    >
      <div className="absolute inset-0 z-0 opacity-55 transition duration-500 group-hover:scale-[1.035] group-hover:opacity-70">
        {backgroundImageUrl ? (
          <CrateImage
            src={backgroundImageUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className=" size-full object-cover grayscale"
          />
        ) : (
          <PlaylistArtwork
            name={title}
            coverDataUrl={coverDataUrl}
            tracks={tracks}
            className=" size-full rounded-none"
          />
        )}
      </div>

      <div
        className={cn(
          "absolute inset-0 z-[1] bg-linear-to-br mix-blend-screen",
          VARIANT_TONES[variant],
        )}
      />
      <div className="editorial-playlist-overlay absolute inset-0 z-[2]" />
      <div className={cn("absolute inset-0 z-[2]", VARIANT_RADIALS[variant])} />
      <div className="editorial-playlist-texture absolute inset-0 z-[2] opacity-35" />

      <img
        src="/icons/logo.svg"
        alt=""
        aria-hidden="true"
        data-testid="crate-editorial-mark"
        className="absolute right-[7%] top-[7%] z-[4] max-h-6 min-h-3.5 size-[8.5cqw] max-w-6 min-w-3.5 opacity-95 drop-shadow-artwork-mark"
      />

      <div
        className={cn("absolute inset-x-[7%] bottom-[7%] z-[4]", textClassName)}
      >
        <div className="max-w-[96%] text-[clamp(1.25rem,21cqw,4.35rem)] font-black uppercase leading-[0.78] tracking-[-0.09em] text-text-primary text-pretty drop-shadow-artwork-text">
          {title}
        </div>
        {kicker ? (
          <div className="mt-[2.5cqw] text-[clamp(0.58rem,5.2cqw,1.05rem)] font-black uppercase leading-none tracking-[0.13em] text-accent-action drop-shadow-artwork-kicker">
            {kicker}
          </div>
        ) : null}
      </div>
    </div>
  );
}
