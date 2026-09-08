import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TFunction } from "i18next";

import type { VisualizerCanvasRect } from "@/components/player/visualizer/canvas-layout";
import type { VisualizerConfigState } from "@/components/player/visualizer/useVisualizerConfig";
import type { CrossfadeTransition } from "@/contexts/PlayerContext";
import type { Track } from "@/contexts/player-types";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";

export type ExtendedPlayerTabId = "queue" | "suggested" | "lyrics" | "info";

export type ExtendedPlayerViewState = {
  currentTrack: Track;
  artistClickable: boolean;
  crossfadeProgress: number;
  crossfadeTransition: CrossfadeTransition | null;
  displayedDuration: number;
  displayedTime: number;
  isBuffering: boolean;
  isPlaying: boolean;
  jamQueueLocked: boolean;
  showEqualizer: boolean;
  showVizSettings: boolean;
  tab: ExtendedPlayerTabId;
  volume: number;
  canvasRect: VisualizerCanvasRect | null;
  vizCfg: VisualizerConfigState;
  equalizerEnabled: boolean;
};

export type ExtendedPlayerViewRefs = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  coverRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  equalizerRef: RefObject<HTMLDivElement | null>;
  equalizerButtonRef: RefObject<HTMLButtonElement | null>;
  vizSettingsRef: RefObject<HTMLDivElement | null>;
  vizSettingsButtonRef: RefObject<HTMLButtonElement | null>;
};

export type ExtendedPlayerViewActions = {
  closeWithFeedback: () => void;
  goToArtist: () => void;
  onSurfaceModeChange: (mode: PlayerSurfaceMode) => void;
  onTabChange: (tab: ExtendedPlayerTabId) => void;
  seek: (time: number) => void;
  setShowEqualizer: Dispatch<SetStateAction<boolean>>;
  setShowVizSettings: Dispatch<SetStateAction<boolean>>;
  toggleDiscPlay: () => void;
};

export type ExtendedPlayerViewProps = {
  actions: ExtendedPlayerViewActions;
  refs: ExtendedPlayerViewRefs;
  state: ExtendedPlayerViewState;
  t: TFunction;
  artistAvatarUrl: string | null;
  sourceLabel: string | null;
  markArtistPhotoFailed: () => void;
  open: boolean;
};
