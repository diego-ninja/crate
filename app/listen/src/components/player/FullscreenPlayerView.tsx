import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { FullscreenPlayerHeader } from "@/components/player/FullscreenPlayerHeader";
import {
  FullscreenPlayerInfoTab,
  FullscreenPlayerLyricsTab,
  FullscreenPlayerPlayerTab,
  FullscreenPlayerQueueTab,
} from "@/components/player/FullscreenPlayerTabs";
import type { FullscreenPlayerViewProps } from "@/components/player/fullscreen-player-view-types";
export function FullscreenPlayerView({
  t,
  state,
  player,
  refs,
  actions,
  lyrics,
  activeLyricIndex,
  playerTabBottomClearance,
  scrollTabBottomClearance,
  onSelectPanel,
  setShowEqualizer,
  markArtistPhotoFailed,
}: FullscreenPlayerViewProps) {
  return (
    <div
      ref={refs.fsRootRef}
      className={`fullscreen-player-surface fixed inset-0 z-fullscreen-player flex flex-col ease-out ${
        state.animating ? "opacity-100" : "opacity-0 translate-y-full"
      }`}
      style={{
        minHeight: "var(--listen-viewport-height)",
        height: "var(--listen-viewport-height)",
        transform:
          state.swipeY > 0 ? `translateY(${state.swipeY}px)` : undefined,
        transition: state.swipeY > 0 ? "none" : "all 300ms ease-out",
        opacity:
          state.swipeY > 0 ? Math.max(0.3, 1 - state.swipeY / 400) : undefined,
      }}
      onTouchStart={actions.onSwipeStart}
      onTouchMove={actions.onSwipeMove}
      onTouchEnd={actions.onSwipeEnd}
    >
      <div
        className="flex justify-center pb-1"
        style={{ paddingTop: "calc(var(--listen-safe-top) + 0.75rem)" }}
      >
        <div className="fullscreen-player-handle h-1 w-10 rounded-full" />
      </div>
      <FullscreenPlayerHeader
        activePanel={state.activePanel}
        onClose={actions.closeWithFeedback}
        onSelectPanel={(panel) => onSelectPanel(panel)}
        t={t}
      />
      {state.allowMobileEqualizer && state.showEqualizer ? (
        <div
          ref={refs.equalizerRef}
          className="listen-mobile-eq-glass absolute left-4 right-4 z-40 overflow-y-auto rounded-xl p-4 animate-fade-slide-up"
          style={{
            top: "var(--listen-mobile-fullscreen-eq-top)",
            maxHeight:
              "calc(var(--listen-viewport-height) - var(--listen-mobile-fullscreen-eq-top) - var(--listen-safe-bottom) - 1rem)",
          }}
        >
          <EqualizerPanel onClose={() => setShowEqualizer(false)} />
        </div>
      ) : null}
      {state.activePanel === null ? (
        <FullscreenPlayerPlayerTab
          state={state}
          player={player}
          refs={refs}
          actions={actions}
          t={t}
          playerTabBottomClearance={playerTabBottomClearance}
          markArtistPhotoFailed={markArtistPhotoFailed}
        />
      ) : null}
      {state.activePanel === "queue" ? (
        <FullscreenPlayerQueueTab
          player={player}
          t={t}
          jumpTo={actions.jumpTo}
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
      {state.activePanel === "lyrics" ? (
        <FullscreenPlayerLyricsTab
          activeLyricIndex={activeLyricIndex}
          lyrics={lyrics}
          refs={refs}
          seek={actions.seek}
          t={t}
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
      {state.activePanel === "info" ? (
        <FullscreenPlayerInfoTab
          scrollTabBottomClearance={scrollTabBottomClearance}
        />
      ) : null}
    </div>
  );
}
