import type { MouseEventHandler } from "react";

import type { CrossfadeTransition } from "@/contexts/player-context";
import type { PlaySource, Track } from "@/contexts/player-types";

interface PlayerBarTrackCopyProps {
  displayTrack: Track;
  displayCrossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  displayPlaySource: PlaySource | null;
  sourceLabel: string | null;
  isDesktop: boolean;
  onOpenAlbum: () => void;
  onOpenArtist: () => void;
  onOpenSource: MouseEventHandler<HTMLButtonElement>;
}

export function PlayerBarTrackCopy({
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
  displayPlaySource,
  sourceLabel,
  isDesktop,
  onOpenAlbum,
  onOpenArtist,
  onOpenSource,
}: PlayerBarTrackCopyProps) {
  const hasAlbum = Boolean(displayTrack.globalAlbumUid || displayTrack.albumId);
  const hasArtist = Boolean(
    displayTrack.globalArtistUid || displayTrack.artistId,
  );

  return (
    <div className="min-w-0 flex-1 md:flex-none md:max-w-[220px] lg:max-w-[300px] xl:max-w-[min(24vw,420px)] 2xl:max-w-[min(28vw,520px)]">
      <div className="relative">
        {displayCrossfadeTransition ? (
          <>
            <div
              className="absolute inset-0"
              style={{ opacity: 1 - crossfadeProgress }}
            >
              <p className="truncate text-[0.8125rem] font-semibold leading-tight text-text-primary">
                {displayCrossfadeTransition.outgoing.title}
              </p>
              <p className="mt-0.5 truncate text-xs leading-tight text-text-muted">
                {displayCrossfadeTransition.outgoing.artist}
              </p>
            </div>
            <div style={{ opacity: crossfadeProgress }}>
              <p className="truncate text-[0.8125rem] font-semibold leading-tight text-text-primary">
                {displayCrossfadeTransition.incoming.title}
              </p>
              <p className="mt-0.5 truncate text-xs leading-tight text-text-muted">
                {displayCrossfadeTransition.incoming.artist}
              </p>
            </div>
          </>
        ) : (
          <div key={displayTrack.id} className="animate-track-in">
            {isDesktop && hasAlbum ? (
              <button
                type="button"
                className="block w-full cursor-pointer truncate text-left text-[0.8125rem] font-semibold leading-tight text-text-primary hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenAlbum();
                }}
              >
                {displayTrack.title}
              </button>
            ) : (
              <p className="truncate text-[0.8125rem] font-semibold leading-tight text-text-primary">
                {displayTrack.title}
              </p>
            )}
            {isDesktop && hasArtist ? (
              <button
                type="button"
                className="mt-0.5 block w-full cursor-pointer truncate text-left text-xs leading-tight text-text-muted transition-colors hover:text-text-primary hover:underline"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenArtist();
                }}
              >
                {displayTrack.artist}
              </button>
            ) : (
              <p className="mt-0.5 truncate text-xs leading-tight text-text-muted">
                {displayTrack.artist}
              </p>
            )}
          </div>
        )}
      </div>
      {sourceLabel ? (
        <div className="relative mt-0.5 hidden h-[14px] lg:block">
          <p
            key={`src-${sourceLabel}`}
            className="animate-fade-in truncate text-xs leading-tight text-text-muted"
          >
            Playing from:{" "}
            {displayPlaySource?.href && sourceLabel !== "Discovery Radio" ? (
              <button
                type="button"
                className="cursor-pointer transition-colors hover:text-text-primary hover:underline"
                onClick={onOpenSource}
              >
                {sourceLabel}
              </button>
            ) : (
              sourceLabel
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
