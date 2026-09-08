import type { MouseEventHandler } from "react";

import { PlayerBarArtwork } from "@/components/player/bar/PlayerBarArtwork";
import { PlayerBarTrackActions } from "@/components/player/bar/PlayerBarTrackActions";
import { PlayerBarTrackCopy } from "@/components/player/bar/PlayerBarTrackCopy";
import type { CrossfadeTransition } from "@/contexts/player-context";
import type { PlaySource, Track } from "@/contexts/player-types";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";

export interface PlayerBarTrackInfoProps {
  displayTrack: Track;
  displayCrossfadeTransition: CrossfadeTransition | null;
  crossfadeProgress: number;
  displayPlaySource: PlaySource | null;
  sourceLabel: string | null;
  isDesktop: boolean;
  liked: boolean;
  isShapedRadioTrack: boolean;
  shapedRadioSessionId: string | null | undefined;
  effectiveDisplayedDuration: number;
  duration: number;
  onNavigate: (path: string) => void;
  onPrepareFullscreen: () => void;
  onOpenFullscreen: () => void;
  onCoverTouchStart: () => void;
  onCoverTouchMove: () => void;
  onCoverTouchEnd: () => void;
  isCoverLongPressTriggered: () => boolean;
  resetCoverLongPress: () => void;
  onToggleLike: () => void;
  onNextTrack: () => void;
  onAddToCollection: () => Promise<void>;
  onOverlayChange: (open: boolean) => void;
}

export function PlayerBarTrackInfo({
  displayTrack,
  displayCrossfadeTransition,
  crossfadeProgress,
  displayPlaySource,
  sourceLabel,
  isDesktop,
  liked,
  isShapedRadioTrack,
  shapedRadioSessionId,
  effectiveDisplayedDuration,
  duration,
  onNavigate,
  onPrepareFullscreen,
  onOpenFullscreen,
  onCoverTouchStart,
  onCoverTouchMove,
  onCoverTouchEnd,
  isCoverLongPressTriggered,
  resetCoverLongPress,
  onToggleLike,
  onNextTrack,
  onAddToCollection,
  onOverlayChange,
}: PlayerBarTrackInfoProps) {
  const handleAlbumNavigation = () => {
    if (!isDesktop || !(displayTrack.globalAlbumUid || displayTrack.albumId)) {
      return;
    }
    onNavigate(
      displayTrack.globalAlbumUid
        ? albumPagePath({
            albumId: displayTrack.albumId,
            globalAlbumUid: displayTrack.globalAlbumUid,
            albumSlug: displayTrack.albumSlug,
            albumName: displayTrack.album,
            artistName: displayTrack.artist,
          })
        : albumPagePath({
            albumId: displayTrack.albumId,
            albumSlug: displayTrack.albumSlug,
            albumName: displayTrack.album,
            artistName: displayTrack.artist,
          }),
    );
  };

  const handleArtistNavigation = () => {
    if (
      !isDesktop ||
      !(displayTrack.globalArtistUid || displayTrack.artistId)
    ) {
      return;
    }
    onNavigate(
      displayTrack.globalArtistUid
        ? artistPagePath({
            artistId: displayTrack.artistId,
            globalArtistUid: displayTrack.globalArtistUid,
            artistSlug: displayTrack.artistSlug,
            artistName: displayTrack.artist,
          })
        : artistPagePath({
            artistId: displayTrack.artistId,
            artistSlug: displayTrack.artistSlug,
            artistName: displayTrack.artist,
          }),
    );
  };

  const handleSourceNavigation: MouseEventHandler<HTMLButtonElement> = (
    event,
  ) => {
    event.stopPropagation();
    if (displayPlaySource?.href) onNavigate(displayPlaySource.href);
  };

  return (
    <div
      role={isDesktop ? undefined : "button"}
      tabIndex={isDesktop ? undefined : 0}
      aria-label={isDesktop ? undefined : "Open fullscreen player"}
      className="flex min-w-0 shrink-0 flex-1 touch-manipulation cursor-pointer items-center gap-3 rounded-xl md:w-[260px] md:flex-none md:cursor-default lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]"
      onTouchStart={() => {
        if (!isDesktop) onPrepareFullscreen();
      }}
      onClick={() => {
        if (!isDesktop) {
          if (isCoverLongPressTriggered()) {
            resetCoverLongPress();
            return;
          }
          onOpenFullscreen();
        }
      }}
      onKeyDown={(event) => {
        if (!isDesktop && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onOpenFullscreen();
        }
      }}
    >
      <PlayerBarArtwork
        displayTrack={displayTrack}
        displayCrossfadeTransition={displayCrossfadeTransition}
        crossfadeProgress={crossfadeProgress}
        isDesktop={isDesktop}
        liked={liked}
        onOpenAlbum={handleAlbumNavigation}
        onCoverTouchStart={onCoverTouchStart}
        onCoverTouchMove={onCoverTouchMove}
        onCoverTouchEnd={onCoverTouchEnd}
      />

      <PlayerBarTrackCopy
        displayTrack={displayTrack}
        displayCrossfadeTransition={displayCrossfadeTransition}
        crossfadeProgress={crossfadeProgress}
        displayPlaySource={displayPlaySource}
        sourceLabel={sourceLabel}
        isDesktop={isDesktop}
        onOpenAlbum={handleAlbumNavigation}
        onOpenArtist={handleArtistNavigation}
        onOpenSource={handleSourceNavigation}
      />

      {isDesktop ? (
        <PlayerBarTrackActions
          displayTrack={displayTrack}
          duration={duration}
          effectiveDisplayedDuration={effectiveDisplayedDuration}
          isShapedRadioTrack={isShapedRadioTrack}
          liked={liked}
          onAddToCollection={onAddToCollection}
          onNextTrack={onNextTrack}
          onOverlayChange={onOverlayChange}
          onToggleLike={onToggleLike}
          shapedRadioSessionId={shapedRadioSessionId}
        />
      ) : null}
    </div>
  );
}
