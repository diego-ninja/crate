import { useMemo } from "react";
import type { TFunction } from "i18next";

import {
  ItemActionMenu,
  ItemActionMenuButton,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { trackToMenuData } from "@/components/actions/shared";
import { useTrackActionEntries } from "@/components/actions/track-actions";
import { CrateImage } from "@/components/artwork/CrateImage";
import { FullscreenPlayerArtwork } from "@/components/player/FullscreenPlayerArtwork";
import { FullscreenPlayerControls } from "@/components/player/FullscreenPlayerControls";
import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { formatPlayerTime } from "@/components/player/bar/player-bar-utils";
import { PlayerTrackIdentity } from "@/components/player/PlayerTrackIdentity";
import type {
  FullscreenPlayerViewProps,
  ViewPlayer,
  ViewRefs,
} from "@/components/player/fullscreen-player-view-types";
import type { FullscreenLyrics } from "@/components/player/fullscreen-player-types";
import type { Track } from "@/contexts/player-types";
import { InfoTab } from "@/components/player/extended/InfoTab";
import { Disc3 } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { triggerHaptic } from "@/lib/haptics";

function withStableDuplicateKeys<T>(
  items: T[],
  getIdentity: (item: T) => string,
): Array<{ item: T; key: string }> {
  const occurrences = new Map<string, number>();

  return items.map((item) => {
    const identity = getIdentity(item);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { item, key: `${identity}-${occurrence}` };
  });
}

function FullscreenQueueRow({
  track,
  onJump,
}: {
  track: Track;
  onJump: () => void;
}) {
  const menuTrack = useMemo(() => trackToMenuData(track), [track]);
  const actions = useTrackActionEntries({
    track: menuTrack,
    albumCover: track.albumCover,
    onPlayNowOverride: onJump,
  });
  const actionMenu = useItemActionMenu(actions);

  const jumpWithFeedback = () => {
    triggerHaptic("selection");
    onJump();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={jumpWithFeedback}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jumpWithFeedback();
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      className="flex w-full items-center gap-3 rounded-lg py-2 text-left transition-colors active:bg-surface-control focus-visible:bg-surface-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
    >
      {track.albumCover ? (
        <CrateImage
          src={track.albumCover}
          alt=""
          loading="lazy"
          className=" size-8 shrink-0 rounded object-cover"
        />
      ) : (
        <div className=" size-8 shrink-0 rounded bg-surface-control-hover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm text-text-primary">
            {track.title}
          </p>
          {track.isSuggested ? (
            <span className="rounded-full border border-accent-action/20 bg-accent-action/10 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-action">
              Suggested
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-text-muted">{track.artist}</p>
      </div>
      <ItemActionMenuButton
        buttonRef={actionMenu.triggerRef}
        hasActions={actionMenu.hasActions}
        onClick={actionMenu.openFromTrigger}
        className=" size-11 shrink-0 opacity-85 transition-opacity hover:opacity-100"
      />
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: track.title,
          subtitle: track.artist,
          detail: track.album,
          imageUrl: track.albumCover,
          imageAlt: track.album ? `${track.title} cover` : track.title,
          imageShape: "square",
          fallbackIcon: Disc3,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
  );
}

export function FullscreenPlayerPlayerTab({
  state,
  player,
  refs,
  actions,
  t,
  playerTabBottomClearance,
  markArtistPhotoFailed,
}: Pick<
  FullscreenPlayerViewProps,
  "state" | "player" | "refs" | "actions" | "t" | "playerTabBottomClearance"
> & {
  markArtistPhotoFailed: () => void;
}) {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6"
      style={{ paddingBottom: playerTabBottomClearance }}
    >
      <div className="relative z-10 mx-auto w-full max-w-[360px]">
        <FullscreenPlayerArtwork
          state={state}
          player={player}
          refs={refs}
          actions={actions}
        />
      </div>
      <div className="relative z-10 mt-5 w-full text-center">
        <PlayerTrackIdentity
          currentTrack={player.currentTrack}
          crossfadeTransition={player.crossfadeTransition}
          crossfadeProgress={player.crossfadeProgress}
          sourceLabel={player.sourceLabel}
          artistAvatarUrl={player.artistAvatarUrl}
          onArtistAvatarError={markArtistPhotoFailed}
          onArtistClick={actions.goToArtist}
          artistClickable={!!player.resolvedArtist?.id}
          titleClassName="text-lg"
          albumClassName="text-xs"
        />
        <div className="mx-auto mt-4 w-full max-w-[360px]">
          <div className="fullscreen-player-time mb-1.5 flex items-center justify-between text-xs font-medium tabular-nums">
            <span>{formatPlayerTime(player.displayedTime)}</span>
            <span>-{formatPlayerTime(player.effectiveRemainingTime)}</span>
          </div>
          <PlayerSeekBar
            currentTime={player.displayedTime}
            duration={player.displayedDuration}
            onSeek={actions.seekWithFeedback}
            disabled={state.jamQueueLocked}
            thin
            variant="glow"
          />
        </div>
        <FullscreenPlayerControls
          state={state}
          player={player}
          actions={actions}
          t={t}
        />
      </div>
    </div>
  );
}

export function FullscreenPlayerQueueTab({
  player,
  t,
  jumpTo,
  scrollTabBottomClearance,
}: {
  player: ViewPlayer;
  t: TFunction;
  jumpTo: (index: number) => void;
  scrollTabBottomClearance: string;
}) {
  const keyedTracks = useMemo(
    () =>
      withStableDuplicateKeys(
        player.upcomingTracks,
        (track) => track.globalTrackUid ?? track.entityUid ?? track.id,
      ),
    [player.upcomingTracks],
  );

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
          {t("player.queue.upNextTracks", {
            count: player.upcomingTracks.length,
          })}
        </p>
        {player.upcomingTracks.length === 0 && (
          <p className="py-2 text-sm text-text-faint">
            {t("player.queue.nothingQueued")}
          </p>
        )}
        {keyedTracks.map(({ item: track, key }, index) => (
          <FullscreenQueueRow
            key={key}
            track={track}
            onJump={() => jumpTo(index)}
          />
        ))}
      </div>
    </div>
  );
}

export function FullscreenPlayerLyricsTab({
  activeLyricIndex,
  lyrics,
  refs,
  seek,
  t,
  scrollTabBottomClearance,
}: {
  activeLyricIndex: number;
  lyrics: FullscreenLyrics | null;
  refs: ViewRefs;
  seek: (time: number) => void;
  t: TFunction;
  scrollTabBottomClearance: string;
}) {
  const syncedLyrics = lyrics?.synced;
  const keyedLines = useMemo(
    () =>
      withStableDuplicateKeys(
        syncedLyrics ?? [],
        (line) => `${line.time}-${line.text}`,
      ),
    [syncedLyrics],
  );

  return (
    <div
      ref={refs.lyricsContainerRef}
      className="relative flex-1 overflow-y-auto px-5 py-4"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <div
        aria-hidden="true"
        className="lyrics-fullscreen-backdrop pointer-events-none absolute inset-0 opacity-70"
      />
      {!lyrics ? (
        <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
          {t("player.lyrics.loading")}
        </p>
      ) : lyrics.synced ? (
        <div className="relative z-10 mx-auto flex w-full max-w-[560px] flex-col items-start gap-3 py-8">
          {keyedLines.map(({ item: line, key }, index) => {
            const active = index === activeLyricIndex;
            const past = index < activeLyricIndex;
            return (
              <button
                key={key}
                type="button"
                ref={active ? refs.activeLyricRef : null}
                onClick={() => {
                  triggerHaptic("selection");
                  seek(line.time);
                }}
                className={cn(
                  "w-full rounded-xl px-1 py-1 text-left font-extrabold tracking-normal transition-[color,filter,opacity,transform] duration-500",
                  active
                    ? "lyrics-active-line text-[1.9rem] leading-[1.08] text-text-primary opacity-100"
                    : past
                      ? "text-[1.55rem] leading-[1.12] text-text-faint opacity-75 blur-[0.7px]"
                      : "text-[1.55rem] leading-[1.12] text-text-subtle opacity-85 blur-[0.35px]",
                )}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      ) : lyrics.plain ? (
        <pre className="relative z-10 mx-auto max-w-[560px] whitespace-pre-wrap py-8 text-left text-[1.45rem] font-extrabold leading-[1.16] text-text-primary">
          {lyrics.plain}
        </pre>
      ) : (
        <p className="relative z-10 mt-20 text-center text-sm text-text-muted">
          {t("player.lyrics.unavailable")}
        </p>
      )}
    </div>
  );
}

export function FullscreenPlayerInfoTab({
  scrollTabBottomClearance,
}: {
  scrollTabBottomClearance: string;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3"
      style={{ paddingBottom: scrollTabBottomClearance }}
    >
      <InfoTab className="pr-0" />
    </div>
  );
}
