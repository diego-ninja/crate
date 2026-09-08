import { CrateImage } from "@/components/artwork/CrateImage";
import { SpinningDisc } from "@/components/player/SpinningDisc";
import { ListMusic } from "@crate/ui/icons";

import type {
  ViewActions,
  ViewPlayer,
  ViewRefs,
  ViewState,
} from "@/components/player/fullscreen-player-view-types";

interface FullscreenPlayerArtworkProps {
  actions: ViewActions;
  player: ViewPlayer;
  refs: ViewRefs;
  state: ViewState;
}

export function FullscreenPlayerArtwork({
  state,
  player,
  refs,
  actions,
}: FullscreenPlayerArtworkProps) {
  const { currentTrack, crossfadeProgress, crossfadeTransition } = player;
  return (
    <div ref={refs.coverRef} className="relative">
      {state.isCdMode ? (
        <SpinningDisc
          albumCover={currentTrack.albumCover}
          className="w-full"
          crossfadeIncomingCover={crossfadeTransition?.incoming.albumCover}
          crossfadeOutgoingCover={crossfadeTransition?.outgoing.albumCover}
          crossfadeProgress={crossfadeProgress}
          currentTime={player.displayedTime}
          duration={player.displayedDuration}
          isBuffering={state.isBuffering}
          isPlaying={state.isPlaying}
          disabled={state.jamQueueLocked}
          jogEnabled
          jogSeekMode={player.spinningDiscJogSeekMode}
          onJoggingChange={actions.setDragging}
          onPlaybackRateChange={actions.setPlaybackRate}
          onSeek={actions.seekWithFeedback}
          onTogglePlay={actions.togglePlaybackWithFeedback}
        />
      ) : (
        <div className="relative aspect-square overflow-hidden rounded-xl">
          {crossfadeTransition ? (
            <>
              {crossfadeTransition.outgoing.albumCover ? (
                <CrateImage
                  src={crossfadeTransition.outgoing.albumCover}
                  alt=""
                  className="fullscreen-player-artwork absolute inset-0 size-full object-cover"
                  style={{ opacity: 1 - crossfadeProgress }}
                />
              ) : null}
              {crossfadeTransition.incoming.albumCover ? (
                <CrateImage
                  src={crossfadeTransition.incoming.albumCover}
                  alt=""
                  className="fullscreen-player-artwork absolute inset-0 size-full object-cover"
                  style={{ opacity: crossfadeProgress }}
                />
              ) : null}
            </>
          ) : currentTrack.albumCover ? (
            <CrateImage
              src={currentTrack.albumCover}
              alt=""
              className="fullscreen-player-artwork size-full object-cover"
            />
          ) : (
            <div className="fullscreen-player-artwork-placeholder flex size-full items-center justify-center">
              <ListMusic size={64} className="fullscreen-player-artwork-icon" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
