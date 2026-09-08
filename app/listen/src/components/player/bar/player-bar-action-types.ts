import type { TFunction } from "i18next";

import type { Track } from "@/contexts/player-types";
import type { PlaybackTargetContext } from "@/lib/playback-targets";
import type { QualityBadge } from "@/components/player/bar/player-bar-utils";

export type PlayerBarActionVisibility = {
  isRemoteConnectActive: boolean;
  extendedOpen: boolean;
  allowEqualizer: boolean;
  showEqualizer: boolean;
  showQueue: boolean;
  showLyrics: boolean;
};

export type PlayerBarActionButtonsProps = {
  t: TFunction;
  qualityBadge: QualityBadge | null;
  showsDeliveryQuality: boolean;
  effectiveVolume: number;
  onVolumeChange: (volume: number) => void;
  onOverlayChange: (open: boolean) => void;
  playbackTargetContext: PlaybackTargetContext;
  visibility: PlayerBarActionVisibility;
  displayQueue: Track[];
  displayCurrentIndex: number;
  onToggleEqualizer: () => void;
  onPrepareEqualizer: () => void;
  onToggleQueue: () => void;
  onPrepareQueue: () => void;
  onToggleLyrics: () => void;
  onPrepareLyrics: () => void;
  onToggleExtendedPlayer: () => void;
  onPrepareExtendedPlayer: () => void;
};
