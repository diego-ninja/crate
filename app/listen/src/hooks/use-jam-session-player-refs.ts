import { useEffect, useRef } from "react";

import type { PlayerActionsValue } from "@/contexts/player-context";

export type JamSessionPlayerActions = Pick<
  PlayerActionsValue,
  | "play"
  | "playAll"
  | "pause"
  | "resume"
  | "seek"
  | "setPlaybackRate"
  | "syncJamQueue"
  | "currentTrack"
  | "playSource"
> & {
  isPlaying: boolean;
};

export function useJamSessionPlayerRefs({
  actions,
  currentTime,
}: {
  actions: JamSessionPlayerActions;
  currentTime: number;
}) {
  const playerActionsRef = useRef<JamSessionPlayerActions>(actions);
  const currentTimeRef = useRef(currentTime);

  useEffect(() => {
    playerActionsRef.current = actions;
    currentTimeRef.current = currentTime;
  }, [actions, currentTime]);

  return { playerActionsRef, currentTimeRef };
}
