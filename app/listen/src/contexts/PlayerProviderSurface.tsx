import type { ReactNode } from "react";

import { ContinuePlaybackPrompt } from "@/components/player/ContinuePlaybackPrompt";
import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";

interface PlayerProviderSurfaceProps {
  children: ReactNode;
  actionsValue: PlayerActionsValue;
  stateValue: PlayerStateValue;
  progressValue: PlayerProgressValue;
  playbackNeedsUserGesture: boolean;
  currentTrack: Track | undefined;
  resumeAfterUserGesture: () => void;
}

export function PlayerProviderSurface({
  children,
  actionsValue,
  stateValue,
  progressValue,
  playbackNeedsUserGesture,
  currentTrack,
  resumeAfterUserGesture,
}: PlayerProviderSurfaceProps) {
  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        <PlayerProgressContext.Provider value={progressValue}>
          {children}
          <ContinuePlaybackPrompt />
          {playbackNeedsUserGesture && currentTrack ? (
            <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--listen-player-bottom-offset,5.5rem)+env(safe-area-inset-bottom))] z-[1600] flex justify-center sm:bottom-28">
              <button
                type="button"
                className="pointer-events-auto rounded-full border border-accent-action/30 bg-surface-canvas/95 px-4 py-3 text-sm font-semibold text-text-primary backdrop-blur"
                onClick={resumeAfterUserGesture}
              >
                Tap to resume playback
              </button>
            </div>
          ) : null}
        </PlayerProgressContext.Provider>
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
