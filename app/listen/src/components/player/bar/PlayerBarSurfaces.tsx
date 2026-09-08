import { Suspense } from "react";
import {
  LazyEqualizerPopover,
  LazyExtendedPlayer,
  LazyFullscreenPlayer,
  LazyLyricsPanel,
  LazyQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import { PlayerSurfaceFallback } from "@/components/player/bar/PlayerSurfaceFallback";

type PlayerBarSurfaceState = {
  isDesktop: boolean;
  fsOpen: boolean;
  showQueue: boolean;
  showLyrics: boolean;
  showEqualizer: boolean;
  extendedOpen: boolean;
  shouldRenderQueuePanel: boolean;
  shouldRenderLyricsPanel: boolean;
  shouldRenderEqualizerPopover: boolean;
  shouldRenderExtendedPlayer: boolean;
  shouldRenderFullscreenPlayer: boolean;
};

type PlayerBarSurfacesProps = {
  state: PlayerBarSurfaceState;
  onCloseQueue: () => void;
  onCloseLyrics: () => void;
  onCloseEqualizer: () => void;
  onCloseExtendedPlayer: () => void;
  onCloseFullscreenPlayer: () => void;
};

export function PlayerBarSurfaces({
  state,
  onCloseQueue,
  onCloseLyrics,
  onCloseEqualizer,
  onCloseExtendedPlayer,
  onCloseFullscreenPlayer,
}: PlayerBarSurfacesProps) {
  return (
    <>
      {state.shouldRenderQueuePanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyQueuePanel open={state.showQueue} onClose={onCloseQueue} />
        </Suspense>
      ) : null}
      {state.shouldRenderLyricsPanel ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyLyricsPanel open={state.showLyrics} onClose={onCloseLyrics} />
        </Suspense>
      ) : null}
      {state.shouldRenderEqualizerPopover ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyEqualizerPopover
            open={state.showEqualizer}
            onClose={onCloseEqualizer}
          />
        </Suspense>
      ) : null}
      {state.shouldRenderExtendedPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback />}>
          <LazyExtendedPlayer
            open={state.extendedOpen}
            onClose={onCloseExtendedPlayer}
          />
        </Suspense>
      ) : null}
      {!state.isDesktop && state.shouldRenderFullscreenPlayer ? (
        <Suspense fallback={<PlayerSurfaceFallback fullscreen />}>
          <LazyFullscreenPlayer
            open={state.fsOpen}
            onClose={onCloseFullscreenPlayer}
          />
        </Suspense>
      ) : null}
    </>
  );
}
