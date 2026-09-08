import { cn } from "@crate/ui/lib/cn";

import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import { ExtendedPlayerArtwork } from "@/components/player/ExtendedPlayerArtwork";
import { ExtendedPlayerHeader } from "@/components/player/ExtendedPlayerHeader";
import { ExtendedPlayerTabs } from "@/components/player/ExtendedPlayerTabs";
import type { ExtendedPlayerViewProps } from "@/components/player/extended-player-view-types";

export type { ExtendedPlayerTabId } from "@/components/player/extended-player-view-types";

function ExtendedPlayerTrackDetails({
  actions,
  state,
  artistAvatarUrl,
  sourceLabel,
  markArtistPhotoFailed,
}: Pick<
  ExtendedPlayerViewProps,
  | "actions"
  | "state"
  | "artistAvatarUrl"
  | "sourceLabel"
  | "markArtistPhotoFailed"
>) {
  return (
    <div className="relative z-20 mt-6 max-w-full px-8 text-center">
      <PlayerTrackIdentity
        currentTrack={state.currentTrack}
        crossfadeTransition={state.crossfadeTransition}
        crossfadeProgress={state.crossfadeProgress}
        sourceLabel={sourceLabel}
        artistAvatarUrl={artistAvatarUrl}
        onArtistAvatarError={markArtistPhotoFailed}
        onArtistClick={actions.goToArtist}
        artistClickable={state.artistClickable}
        titleClassName="text-xl leading-tight"
        albumClassName="text-sm"
      />
      {state.vizCfg.trackVizProfile.hasAnalysis &&
      state.vizCfg.trackVizProfile.summary ? (
        <p className="mt-2 text-xs font-medium uppercase tracking-[0.22em] text-text-muted">
          {state.vizCfg.trackVizProfile.summary}
        </p>
      ) : null}
      <PlayerSeekBar
        className="mx-auto mt-5 w-full max-w-[420px]"
        currentTime={state.displayedTime}
        duration={state.displayedDuration}
        onSeek={actions.seek}
        disabled={state.jamQueueLocked}
        showTimes
        variant="glow"
      />
    </div>
  );
}

export function ExtendedPlayerView({
  actions,
  refs,
  state,
  t,
  artistAvatarUrl,
  sourceLabel,
  markArtistPhotoFailed,
  open,
}: ExtendedPlayerViewProps) {
  return (
    <div
      className={cn(
        "z-app-extended-player fixed inset-0 flex bg-surface-canvas transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform",
        open
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-full opacity-0",
      )}
    >
      <div
        ref={refs.panelRef}
        className="relative flex w-1/2 flex-col items-center justify-center overflow-hidden bg-surface-canvas"
      >
        <ExtendedPlayerHeader
          actions={actions}
          refs={refs}
          state={state}
          t={t}
        />
        <ExtendedPlayerArtwork actions={actions} refs={refs} state={state} />
        <ExtendedPlayerTrackDetails
          actions={actions}
          state={state}
          artistAvatarUrl={artistAvatarUrl}
          sourceLabel={sourceLabel}
          markArtistPhotoFailed={markArtistPhotoFailed}
        />
      </div>
      <ExtendedPlayerTabs actions={actions} state={state} t={t} />
    </div>
  );
}
