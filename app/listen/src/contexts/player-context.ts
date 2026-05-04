import { createContext } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

export interface CrossfadeTransition {
  outgoing: Track;
  incoming: Track;
  durationMs: number;
  startedAt: number;
  outgoingDurationSeconds: number;
}

export interface PlayerStateValue {
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  analyserVersion: number;
  crossfadeTransition: CrossfadeTransition | null;
}

export interface PlayerProgressValue {
  currentTime: number;
  duration: number;
}

export interface PlayerActionsValue {
  queue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  recentlyPlayed: Track[];
  currentTrack: Track | undefined;
  play: (track: Track, source?: PlaySource) => void;
  playAll: (tracks: Track[], startIndex?: number, source?: PlaySource) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

export type PlayerContextValue = PlayerStateValue & PlayerProgressValue & PlayerActionsValue;

export const PlayerStateContext = createContext<PlayerStateValue | null>(null);
export const PlayerProgressContext = createContext<PlayerProgressValue | null>(null);
export const PlayerActionsContext = createContext<PlayerActionsValue | null>(null);
