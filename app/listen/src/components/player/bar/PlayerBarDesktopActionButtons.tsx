import {
  CRATE_ICON_SIZE,
  ListMusic,
  Maximize2,
  Mic2,
  SlidersHorizontal,
} from "@crate/ui/icons";

import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";
import { QualityBadge } from "@/components/player/bar/QualityBadge";
import { PlayerBarActionIconButton } from "@/components/player/bar/PlayerBarActionIconButton";
import type { PlayerBarActionButtonsProps } from "@/components/player/bar/player-bar-action-types";

export function PlayerBarDesktopActionButtons({
  t,
  qualityBadge,
  showsDeliveryQuality,
  effectiveVolume,
  onVolumeChange,
  onOverlayChange,
  playbackTargetContext,
  visibility,
  displayQueue,
  displayCurrentIndex,
  onToggleEqualizer,
  onPrepareEqualizer,
  onToggleQueue,
  onPrepareQueue,
  onToggleLyrics,
  onPrepareLyrics,
  onToggleExtendedPlayer,
  onPrepareExtendedPlayer,
}: PlayerBarActionButtonsProps) {
  const {
    isRemoteConnectActive,
    extendedOpen,
    allowEqualizer,
    showEqualizer,
    showQueue,
    showLyrics,
  } = visibility;

  return (
    <div className="hidden shrink-0 items-center justify-end md:flex md:w-[260px] lg:w-[340px] xl:w-[min(34vw,520px)] 2xl:w-[min(38vw,680px)]">
      <div className="hidden items-center justify-end gap-1 lg:flex">
        {qualityBadge && (
          <span className="mr-1 inline-flex items-center">
            <QualityBadge
              badge={qualityBadge}
              origin={showsDeliveryQuality ? "stream" : "source"}
            />
          </span>
        )}

        <PlayerVolumeControl
          volume={effectiveVolume}
          onVolumeChange={onVolumeChange}
          onOverlayChange={onOverlayChange}
        />

        <PlaybackTargetMenu
          onOverlayChange={onOverlayChange}
          targetContext={playbackTargetContext}
        />

        {!isRemoteConnectActive && !extendedOpen && allowEqualizer && (
          <PlayerBarActionIconButton
            onClick={onToggleEqualizer}
            onPrepare={onPrepareEqualizer}
            label={t("player.equalizer")}
            active={showEqualizer}
          >
            <SlidersHorizontal size={CRATE_ICON_SIZE.md} />
          </PlayerBarActionIconButton>
        )}

        {!extendedOpen && (
          <PlayerBarActionIconButton
            onClick={onToggleQueue}
            onPrepare={onPrepareQueue}
            label={t("player.queue")}
            active={showQueue}
            className="relative"
          >
            <ListMusic size={CRATE_ICON_SIZE.md} />
            {displayQueue.length > 1 && (
              <span className="absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full bg-accent-action text-xs font-bold text-accent-action-foreground">
                {displayQueue.length - displayCurrentIndex - 1}
              </span>
            )}
          </PlayerBarActionIconButton>
        )}

        {!isRemoteConnectActive && !extendedOpen && (
          <PlayerBarActionIconButton
            onClick={onToggleLyrics}
            onPrepare={onPrepareLyrics}
            label={t("player.lyrics")}
            active={showLyrics}
            className="hidden xl:block"
          >
            <Mic2 size={CRATE_ICON_SIZE.md} />
          </PlayerBarActionIconButton>
        )}

        {!isRemoteConnectActive && (
          <PlayerBarActionIconButton
            onClick={onToggleExtendedPlayer}
            onPrepare={onPrepareExtendedPlayer}
            label={t("player.expand")}
            active={extendedOpen}
          >
            <Maximize2 size={CRATE_ICON_SIZE.md} />
          </PlayerBarActionIconButton>
        )}
      </div>
    </div>
  );
}
