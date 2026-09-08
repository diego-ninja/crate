import { cn } from "@crate/ui/lib/cn";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";

interface PlayerTrackIdentityProps {
  currentTrack: Track;
  crossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  sourceLabel?: string | null;
  artistAvatarUrl?: string | null;
  onArtistAvatarError?: () => void;
  onArtistClick?: () => void;
  artistClickable?: boolean;
  align?: "center" | "left";
  className?: string;
  titleClassName?: string;
  albumClassName?: string;
  sourceClassName?: string;
  badgeClassName?: string;
  badgeTextClassName?: string;
  badgeMaxWidthClassName?: string;
}

export function PlayerTrackIdentity({
  currentTrack,
  crossfadeTransition,
  crossfadeProgress,
  sourceLabel,
  artistAvatarUrl,
  onArtistAvatarError,
  onArtistClick,
  artistClickable = false,
  align = "center",
  className,
  titleClassName,
  albumClassName,
  sourceClassName,
  badgeClassName,
  badgeTextClassName,
  badgeMaxWidthClassName,
}: PlayerTrackIdentityProps) {
  const center = align === "center";

  return (
    <div className={cn(center ? "text-center" : "text-left", className)}>
      {sourceLabel ? (
        <p
          className={cn(
            "mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-subtle",
            sourceClassName,
          )}
        >
          Playing from: {sourceLabel}
        </p>
      ) : null}

      <div className="relative">
        {crossfadeTransition ? (
          <>
            <div
              className="absolute inset-0"
              style={{ opacity: 1 - crossfadeProgress }}
            >
              <h2
                className={cn(
                  "truncate font-bold text-text-primary",
                  titleClassName,
                )}
              >
                {crossfadeTransition.outgoing.title}
              </h2>
              {crossfadeTransition.outgoing.album ? (
                <p
                  className={cn(
                    "mt-1 truncate text-text-muted",
                    albumClassName,
                  )}
                >
                  {crossfadeTransition.outgoing.album}
                </p>
              ) : null}
            </div>
            <div style={{ opacity: crossfadeProgress }}>
              <h2
                className={cn(
                  "truncate font-bold text-text-primary",
                  titleClassName,
                )}
              >
                {crossfadeTransition.incoming.title}
              </h2>
              {crossfadeTransition.incoming.album ? (
                <p
                  className={cn(
                    "mt-1 truncate text-text-muted",
                    albumClassName,
                  )}
                >
                  {crossfadeTransition.incoming.album}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h2
              className={cn(
                "truncate font-bold text-text-primary",
                titleClassName,
              )}
            >
              {currentTrack.title}
            </h2>
            {currentTrack.album ? (
              <p
                className={cn("mt-1 truncate text-text-muted", albumClassName)}
              >
                {currentTrack.album}
              </p>
            ) : null}
          </>
        )}
      </div>

      <div
        className={cn("mt-2 flex", center ? "justify-center" : "justify-start")}
      >
        <button
          onClick={onArtistClick}
          aria-label={`Go to ${currentTrack.artist}`}
          disabled={!artistClickable}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-quiet-subtle px-2 py-1.5 transition-colors",
            artistClickable
              ? "active:bg-surface-control-hover"
              : "cursor-default",
            badgeClassName,
          )}
        >
          {artistAvatarUrl ? (
            <CrateImage
              src={artistAvatarUrl}
              alt={currentTrack.artist}
              className=" size-7 rounded-full object-cover"
              onError={onArtistAvatarError}
            />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-full bg-surface-control-hover text-xs font-semibold text-text-secondary">
              {currentTrack.artist.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span
            className={cn(
              "truncate text-[0.75rem] font-medium text-text-primary",
              badgeTextClassName,
              badgeMaxWidthClassName ?? "max-w-[240px]",
            )}
          >
            {currentTrack.artist}
          </span>
        </button>
      </div>
    </div>
  );
}
