import { useContext, type ReactNode } from "react";

import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerContextValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import { usePlayerProviderRuntime } from "@/contexts/use-player-provider-runtime";

export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
export type { CrossfadeTransition } from "@/contexts/player-context";
export { shouldRestartTrackBeforePrev } from "@/contexts/player-queue-helpers";

export function usePlayerState(): PlayerStateValue {
  const ctx = useContext(PlayerStateContext);
  if (!ctx)
    throw new Error("usePlayerState must be used within PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActionsValue {
  const ctx = useContext(PlayerActionsContext);
  if (!ctx)
    throw new Error("usePlayerActions must be used within PlayerProvider");
  return ctx;
}

export function usePlayerProgress(): PlayerProgressValue {
  const ctx = useContext(PlayerProgressContext);
  if (!ctx)
    throw new Error("usePlayerProgress must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const progress = usePlayerProgress();
  const actions = usePlayerActions();
  return { ...state, ...progress, ...actions };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  return usePlayerProviderRuntime(children);
}
