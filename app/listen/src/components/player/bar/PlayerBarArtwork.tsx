import type {
  KeyboardEvent as ReactKeyboardEvent,
  KeyboardEventHandler,
  MouseEvent as ReactMouseEvent,
  MouseEventHandler,
} from "react";

import { HeartBold } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";

interface PlayerBarArtworkProps {
  displayTrack: Track;
  displayCrossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  isDesktop: boolean;
  liked: boolean;
  onOpenAlbum: () => void;
  onCoverTouchStart: () => void;
  onCoverTouchMove: () => void;
  onCoverTouchEnd: () => void;
}

interface ArtworkInteractionOptions {
  isDesktop: boolean;
  hasAlbum: boolean;
  onOpenAlbum: () => void;
}

function getArtworkInteractionProps({
  isDesktop,
  hasAlbum,
  onOpenAlbum,
}: ArtworkInteractionOptions) {
  const props: {
    "aria-label"?: string;
    role?: "button";
    tabIndex?: number;
    className: string;
    onClick?: MouseEventHandler<HTMLDivElement>;
    onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  } = {
    "aria-label": !isDesktop
      ? "Track artwork"
      : hasAlbum
        ? "Open album"
        : undefined,
    className: `listen-player-artwork relative size-10 shrink-0 overflow-hidden rounded-md md:size-12 ${
      isDesktop && hasAlbum ? "cursor-pointer" : ""
    }`,
  };

  if (!isDesktop || !hasAlbum) return props;

  return {
    ...props,
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      event.stopPropagation();
      onOpenAlbum();
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onOpenAlbum();
    },
  };
}

function PlayerBarArtworkImage({
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
}: Pick<
  PlayerBarArtworkProps,
  "displayTrack" | "displayCrossfadeTransition" | "crossfadeProgress"
>) {
  if (displayCrossfadeTransition) {
    return (
      <>
        {displayCrossfadeTransition.outgoing.albumCover ? (
          <CrateImage
            src={displayCrossfadeTransition.outgoing.albumCover}
            alt=""
            className="absolute inset-0 size-full object-cover"
            style={{ opacity: 1 - crossfadeProgress }}
          />
        ) : null}
        {displayCrossfadeTransition.incoming.albumCover ? (
          <CrateImage
            src={displayCrossfadeTransition.incoming.albumCover}
            alt=""
            className="absolute inset-0 size-full object-cover"
            style={{ opacity: crossfadeProgress }}
          />
        ) : null}
      </>
    );
  }

  if (displayTrack.albumCover) {
    return (
      <CrateImage
        src={displayTrack.albumCover}
        alt=""
        className=" size-full object-cover"
      />
    );
  }

  return <div className="listen-player-artwork-placeholder size-full" />;
}

function PlayerBarLikedIndicator({ liked }: { liked: boolean }) {
  if (!liked) return null;

  return (
    <span
      aria-label="Liked track"
      className="listen-player-liked-indicator absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full backdrop-blur-md"
    >
      <HeartBold size={10} className="animate-crate-icon-active-pulse" />
    </span>
  );
}

export function PlayerBarArtwork({
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
  isDesktop,
  liked,
  onOpenAlbum,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
}: PlayerBarArtworkProps) {
  const hasAlbum = Boolean(displayTrack.globalAlbumUid || displayTrack.albumId);
  const interactionProps = getArtworkInteractionProps({
    isDesktop,
    hasAlbum,
    onOpenAlbum,
  });

  return (
    <div
      {...interactionProps}
      onTouchStart={onCoverTouchStart}
      onTouchMove={onCoverTouchMove}
      onTouchEnd={onCoverTouchEnd}
      onTouchCancel={onCoverTouchEnd}
    >
      <PlayerBarArtworkImage
        displayTrack={displayTrack}
        displayCrossfadeTransition={displayCrossfadeTransition}
        crossfadeProgress={crossfadeProgress}
      />
      {!isDesktop ? <PlayerBarLikedIndicator liked={liked} /> : null}
    </div>
  );
}
