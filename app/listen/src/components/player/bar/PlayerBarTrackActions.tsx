import { Heart, HeartBold, CRATE_ICON_SIZE } from "@crate/ui/icons";

import { PlayerTrackMenu } from "@/components/player/bar/PlayerTrackMenu";
import { RadioFeedback } from "@/components/player/RadioFeedback";
import type { Track } from "@/contexts/player-types";

interface PlayerBarTrackActionsProps {
  displayTrack: Track;
  duration: number;
  effectiveDisplayedDuration: number;
  isShapedRadioTrack: boolean;
  liked: boolean;
  onAddToCollection: () => Promise<void>;
  onNextTrack: () => void;
  onOverlayChange: (open: boolean) => void;
  onToggleLike: () => void;
  shapedRadioSessionId: string | null | undefined;
}

export function PlayerBarTrackActions({
  displayTrack,
  duration,
  effectiveDisplayedDuration,
  isShapedRadioTrack,
  liked,
  onAddToCollection,
  onNextTrack,
  onOverlayChange,
  onToggleLike,
  shapedRadioSessionId,
}: PlayerBarTrackActionsProps) {
  return (
    <div className="ml-1 flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleLike();
        }}
        className="shrink-0 p-1.5 transition-[color,filter,transform] hover:-translate-y-px"
      >
        {liked ? (
          <HeartBold
            size={CRATE_ICON_SIZE.md}
            className="animate-crate-icon-active-pulse text-accent-action"
          />
        ) : (
          <Heart
            size={CRATE_ICON_SIZE.md}
            className="text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
          />
        )}
      </button>

      {isShapedRadioTrack && shapedRadioSessionId ? (
        <RadioFeedback
          sessionId={shapedRadioSessionId}
          trackId={displayTrack.libraryTrackId}
          globalTrackUid={displayTrack.globalTrackUid}
          onDislike={onNextTrack}
        />
      ) : null}

      <div onClick={(event) => event.stopPropagation()}>
        <PlayerTrackMenu
          currentTrack={displayTrack}
          duration={effectiveDisplayedDuration || duration}
          onOverlayChange={onOverlayChange}
          onAddToCollection={onAddToCollection}
        />
      </div>
    </div>
  );
}
