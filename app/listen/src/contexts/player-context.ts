import { createContext } from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import type { PlayerQueueSnapshot } from "@/contexts/player-session";
import type { ConnectedPlaybackInstance } from "@/hooks/use-crate-connect-ws";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";

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

export interface JamTransportControls {
  canControl: boolean;
  togglePlayPause: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
}

export interface PlayerActionsValue {
  queue: Track[];
  currentIndex: number;
  jamQueueLocked: boolean;
  jamTransport: JamTransportControls | null;
  shuffle: boolean;
  repeat: RepeatMode;
  smartCrossfadeEnabled: boolean;
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
  setPlaybackRate: (rate: number) => void;
  clearQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (index: number) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  enterJamSession: () => void;
  leaveJamSession: () => void;
  setJamTransport: (controls: JamTransportControls | null) => void;
  syncJamQueue: (
    tracks: Track[],
    options?: {
      currentTrack?: Track | null;
      positionSeconds?: number;
      playing?: boolean;
      queueOnly?: boolean;
      forcePosition?: boolean;
      source?: PlaySource;
    },
  ) => void;
  captureQueueSnapshot: () => PlayerQueueSnapshot;
  restoreQueueSnapshot: (snapshot: PlayerQueueSnapshot) => void;
  publishConnectState: (options?: { claimActive?: boolean }) => Promise<void>;
  connect: PlayerConnectValue;
}

export interface PlayerConnectValue {
  activeInstanceId: string | null;
  connectedInstances: ConnectedPlaybackInstance[];
  enabled: boolean;
  isRemoteActive: boolean;
  playbackInstanceId: string | null;
  remoteState: RemotePlaybackState | null;
  requestTransfer: (targetInstanceId: string) => boolean;
  sendRemoteCommand: (
    type:
      | "pause"
      | "resume"
      | "seek"
      | "next_track"
      | "previous_track"
      | "volume",
    payload?: Record<string, unknown>,
  ) => boolean;
  serverClockOffsetMs: number;
  transport: "legacy" | "ws" | null;
}

export type PlayerContextValue = PlayerStateValue &
  PlayerProgressValue &
  PlayerActionsValue;

export const PlayerStateContext = createContext<PlayerStateValue | null>(null);
export const PlayerProgressContext = createContext<PlayerProgressValue | null>(
  null,
);
export const PlayerActionsContext = createContext<PlayerActionsValue | null>(
  null,
);
