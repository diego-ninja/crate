import type { TFunction } from "i18next";

import {
  Disc3,
  Heart,
  HeartBold,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Square,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import type {
  ViewActions,
  ViewPlayer,
  ViewState,
} from "@/components/player/fullscreen-player-view-types";
import { SpectrumPlayButton } from "@/components/player/SpectrumPlayButton";
import { triggerHaptic } from "@/lib/haptics";

interface FullscreenPlayerTransportControlsProps {
  actions: ViewActions;
  state: ViewState;
  t: TFunction;
}

function FullscreenPlayerTransportControls({
  state,
  actions,
  t,
}: FullscreenPlayerTransportControlsProps) {
  return (
    <div className="mx-auto mt-5 flex w-full max-w-[360px] items-center justify-center gap-3">
      <button
        type="button"
        onClick={actions.toggleShuffleWithFeedback}
        disabled={state.jamQueueLocked}
        aria-label={
          state.shuffle ? t("player.disableShuffle") : t("player.enableShuffle")
        }
        className={cn(
          "flex h-12 w-12 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-surface-control disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40",
          state.shuffle
            ? "text-accent-action drop-shadow-accent-action"
            : "text-text-muted active:text-text-secondary",
        )}
      >
        <Shuffle size={CRATE_ICON_SIZE.lg} />
      </button>
      <button
        type="button"
        onClick={actions.goPrevWithFeedback}
        disabled={state.jamQueueLocked}
        aria-label={t("player.previous")}
        className="flex size-12 touch-manipulation items-center justify-center rounded-full text-text-secondary transition-colors active:bg-surface-control active:text-text-primary disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40"
      >
        <SkipBack size={CRATE_ICON_SIZE.xl} fill="currentColor" />
      </button>
      <SpectrumPlayButton
        onClick={actions.togglePlaybackWithFeedback}
        disabled={state.jamTransportDisabled}
        aria-label={state.isPlaying ? t("player.pause") : t("player.play")}
        size="lg"
        active={state.isPlaying}
        className="touch-manipulation disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40 disabled:hover:scale-100"
      >
        {state.isBuffering ? (
          <Loader2
            size={CRATE_ICON_SIZE.xl}
            className="animate-spin text-accent-action"
          />
        ) : state.isPlaying ? (
          <Pause size={26} className="text-text-primary" />
        ) : (
          <Play
            size={26}
            className="ml-1 text-text-primary"
            fill="currentColor"
          />
        )}
      </SpectrumPlayButton>
      <button
        type="button"
        onClick={actions.goNextWithFeedback}
        disabled={state.jamTransportDisabled}
        aria-label={t("player.next")}
        className="flex size-12 touch-manipulation items-center justify-center rounded-full text-text-secondary transition-colors active:bg-surface-control active:text-text-primary disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40"
      >
        <SkipForward size={CRATE_ICON_SIZE.xl} fill="currentColor" />
      </button>
      <button
        type="button"
        onClick={actions.cycleRepeatWithFeedback}
        disabled={state.jamQueueLocked}
        aria-label={t("player.repeat", { mode: state.repeat })}
        className={cn(
          "flex h-12 w-12 touch-manipulation items-center justify-center rounded-full transition-colors active:bg-surface-control disabled:cursor-not-allowed disabled:grayscale disabled:opacity-40",
          state.repeat !== "off"
            ? "text-accent-action drop-shadow-accent-action"
            : "text-text-muted active:text-text-secondary",
        )}
      >
        {state.repeat === "one" ? (
          <Repeat1 size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Repeat size={CRATE_ICON_SIZE.lg} />
        )}
      </button>
    </div>
  );
}

interface FullscreenPlayerUtilityControlsProps {
  actions: ViewActions;
  player: ViewPlayer;
  state: ViewState;
  t: TFunction;
}

function FullscreenPlayerUtilityControls({
  state,
  player,
  actions,
  t,
}: FullscreenPlayerUtilityControlsProps) {
  return (
    <div className="mx-auto mt-3 flex w-full max-w-[360px] items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => void actions.toggleLikeWithFeedback()}
        aria-label={state.liked ? "Unlike track" : "Like track"}
        className="flex size-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
      >
        {state.liked ? (
          <HeartBold
            size={19}
            className="animate-crate-icon-active-pulse text-accent-action drop-shadow-accent-action"
          />
        ) : (
          <Heart size={19} />
        )}
      </button>
      {state.allowMobileEqualizer ? (
        <button
          type="button"
          ref={actions.equalizerButtonRef}
          onClick={() => {
            triggerHaptic("selection");
            actions.setShowEqualizer((value) => !value);
          }}
          aria-label={t("player.equalizer")}
          className={cn(
            "flex h-12 w-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control transition-colors active:bg-surface-control-hover",
            state.showEqualizer
              ? "text-accent-action drop-shadow-accent-action"
              : "text-text-secondary active:text-text-primary",
          )}
        >
          <SlidersHorizontal size={CRATE_ICON_SIZE.lg} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={actions.toggleSurfaceModeWithFeedback}
        aria-label={
          state.surfaceMode === "cd" ? "Show album cover" : "Show spinning CD"
        }
        title={
          state.surfaceMode === "cd" ? "Show album cover" : "Show spinning CD"
        }
        className="flex size-12 touch-manipulation items-center justify-center rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
      >
        {state.surfaceMode === "cd" ? (
          <Square size={CRATE_ICON_SIZE.lg} />
        ) : (
          <Disc3 size={CRATE_ICON_SIZE.lg} />
        )}
      </button>
      <PlayerTrackMenu
        currentTrack={player.currentTrack}
        className=" size-12 rounded-full border border-border-subtle bg-surface-control text-text-secondary transition-colors active:bg-surface-control-hover active:text-text-primary"
      />
    </div>
  );
}

export function FullscreenPlayerControls({
  state,
  player,
  actions,
  t,
}: FullscreenPlayerUtilityControlsProps) {
  return (
    <>
      <FullscreenPlayerTransportControls
        state={state}
        actions={actions}
        t={t}
      />
      <FullscreenPlayerUtilityControls
        state={state}
        player={player}
        actions={actions}
        t={t}
      />
    </>
  );
}
