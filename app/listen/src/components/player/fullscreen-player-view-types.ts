import type { Dispatch, RefObject, SetStateAction } from "react";
import type { TFunction } from "i18next";

import type { CrossfadeTransition } from "@/contexts/player-context";
import type { RepeatMode, Track } from "@/contexts/player-types";
import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import type {
  FSPanel,
  FullscreenLyrics,
} from "@/components/player/fullscreen-player-types";

export type ViewState = {
  activePanel: FSPanel | null;
  animating: boolean;
  allowMobileEqualizer: boolean;
  isBuffering: boolean;
  isCdMode: boolean;
  isPlaying: boolean;
  jamQueueLocked: boolean;
  jamTransportDisabled: boolean;
  liked: boolean;
  repeat: RepeatMode;
  showEqualizer: boolean;
  shuffle: boolean;
  surfaceMode: PlayerSurfaceMode;
  swipeY: number;
};

export type ViewPlayer = {
  currentTrack: Track;
  crossfadeProgress: number;
  crossfadeTransition: CrossfadeTransition | null;
  displayedDuration: number;
  displayedTime: number;
  duration: number;
  effectiveRemainingTime: number;
  resolvedArtist: {
    id?: number | null;
    globalArtistUid?: string | null;
    slug?: string | null;
    name?: string | null;
  } | null;
  artistAvatarUrl: string | null;
  sourceLabel: string | null;
  spinningDiscJogSeekMode: "commit" | "live";
  upcomingTracks: Track[];
};

export type ViewRefs = {
  activeLyricRef: RefObject<HTMLButtonElement | null>;
  coverRef: RefObject<HTMLDivElement | null>;
  equalizerButtonRef: RefObject<HTMLButtonElement | null>;
  equalizerRef: RefObject<HTMLDivElement | null>;
  fsRootRef: RefObject<HTMLDivElement | null>;
  lyricsContainerRef: RefObject<HTMLDivElement | null>;
};

export type ViewActions = {
  closeWithFeedback: () => void;
  cycleRepeatWithFeedback: () => void;
  goNextWithFeedback: () => void;
  goPrevWithFeedback: () => void;
  goToArtist: () => void;
  jumpTo: (index: number) => void;
  onClose: () => void;
  onSwipeEnd: (event: React.TouchEvent) => void;
  onSwipeMove: (event: React.TouchEvent) => void;
  onSwipeStart: (event: React.TouchEvent) => void;
  seek: (time: number) => void;
  seekWithFeedback: (time: number) => void;
  setDragging: (dragging: boolean) => void;
  setShowEqualizer: Dispatch<SetStateAction<boolean>>;
  setPlaybackRate: (rate: number) => void;
  equalizerButtonRef: RefObject<HTMLButtonElement | null>;
  toggleLikeWithFeedback: () => Promise<void>;
  togglePlaybackWithFeedback: () => void;
  toggleShuffleWithFeedback: () => void;
  toggleSurfaceModeWithFeedback: () => void;
};

export type FullscreenPlayerViewProps = {
  t: TFunction;
  state: ViewState;
  player: ViewPlayer;
  refs: ViewRefs;
  actions: ViewActions;
  lyrics: FullscreenLyrics | null;
  activeLyricIndex: number;
  playerTabBottomClearance: string;
  scrollTabBottomClearance: string;
  onSelectPanel: Dispatch<SetStateAction<FSPanel | null>>;
  setShowEqualizer: Dispatch<SetStateAction<boolean>>;
  markArtistPhotoFailed: () => void;
};
