import { cn } from "@crate/ui/lib/cn";

import { CrateImage } from "@/components/artwork/CrateImage";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewRefs,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";

type ExtendedPlayerArtworkProps = {
  actions: ExtendedPlayerViewActions;
  refs: ExtendedPlayerViewRefs;
  state: ExtendedPlayerViewState;
};

function ExtendedPlayerCover({
  actions,
  refs,
  state,
}: ExtendedPlayerArtworkProps) {
  const isCdMode = state.vizCfg.surfaceMode === "cd";
  const { currentTrack, crossfadeTransition } = state;

  return (
    <div
      ref={refs.coverRef}
      className="relative z-0 aspect-square w-[72%] max-w-[500px] shrink-0"
    >
      {isCdMode ? (
        <SpinningDisc
          albumCover={currentTrack.albumCover}
          className="w-full"
          crossfadeIncomingCover={crossfadeTransition?.incoming.albumCover}
          crossfadeOutgoingCover={crossfadeTransition?.outgoing.albumCover}
          crossfadeProgress={state.crossfadeProgress}
          currentTime={state.displayedTime}
          duration={state.displayedDuration}
          isBuffering={state.isBuffering}
          isPlaying={state.isPlaying}
          disabled={state.jamQueueLocked}
          onTogglePlay={actions.toggleDiscPlay}
        />
      ) : (
        <ExtendedPlayerCoverArt state={state} />
      )}
    </div>
  );
}

function ExtendedPlayerCoverArt({
  state,
}: Pick<ExtendedPlayerArtworkProps, "state">) {
  const isVisualizerMode = state.vizCfg.surfaceMode === "visualizer";
  const { currentTrack, crossfadeTransition } = state;
  const imageStyle = {
    filter: isVisualizerMode ? "grayscale(100%) brightness(0.35)" : "none",
  };

  return (
    <>
      <div className="absolute inset-6 rounded-xl bg-accent-action/10 opacity-70 blur-3xl" />
      <div className="absolute inset-2 rounded-xl border border-border-quiet bg-surface-quiet-subtle" />
      {crossfadeTransition ? (
        <>
          {crossfadeTransition.outgoing.albumCover ? (
            <CrateImage
              src={crossfadeTransition.outgoing.albumCover}
              alt=""
              className="absolute inset-0 size-full rounded-xl object-cover shadow-player-artwork-layered"
              style={{ ...imageStyle, opacity: 1 - state.crossfadeProgress }}
            />
          ) : null}
          {crossfadeTransition.incoming.albumCover ? (
            <CrateImage
              src={crossfadeTransition.incoming.albumCover}
              alt=""
              className="absolute inset-0 size-full rounded-xl object-cover shadow-player-artwork-layered"
              style={{ ...imageStyle, opacity: state.crossfadeProgress }}
            />
          ) : null}
        </>
      ) : currentTrack.albumCover ? (
        <CrateImage
          src={currentTrack.albumCover}
          alt=""
          className="absolute inset-0 size-full rounded-xl object-cover shadow-player-artwork-layered"
          style={imageStyle}
        />
      ) : (
        <div className="absolute inset-0 rounded-xl bg-surface-quiet-subtle shadow-player-artwork" />
      )}
    </>
  );
}

function ExtendedPlayerVisualizerCanvas({
  refs,
  state,
}: Pick<ExtendedPlayerArtworkProps, "refs" | "state">) {
  const isVisualizerMode = state.vizCfg.surfaceMode === "visualizer";
  return (
    <div
      className={cn(
        "pointer-events-none absolute",
        state.showVizSettings ? "z-30" : "z-10",
        isVisualizerMode && state.canvasRect ? "" : "hidden",
      )}
      style={
        state.canvasRect
          ? {
              top: state.canvasRect.top,
              left: state.canvasRect.left,
              width: state.canvasRect.width,
              height: state.canvasRect.height,
            }
          : undefined
      }
    >
      <canvas
        ref={refs.canvasRef}
        className=" size-full"
        data-viz-reference-size={
          state.canvasRect ? String(state.canvasRect.referenceSize) : undefined
        }
        style={{ background: "transparent" }}
      />
    </div>
  );
}

export function ExtendedPlayerArtwork({
  actions,
  refs,
  state,
}: ExtendedPlayerArtworkProps) {
  return (
    <>
      <ExtendedPlayerCover actions={actions} refs={refs} state={state} />
      <ExtendedPlayerVisualizerCanvas refs={refs} state={state} />
    </>
  );
}
