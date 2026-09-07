import { ListMusic, Pause, Play, SkipForward, Zap } from "@crate/ui/icons";
import type { CSSProperties } from "react";
import type { TFunction } from "i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { Track } from "@/contexts/PlayerContext";
import { formatDuration } from "@/lib/utils";
import type { JamQueueItem } from "@/pages/jam-reducer";

import { HeroActionButton } from "./JamHeroButtons";

export interface JamNowPlayingProps {
  t: TFunction;
  roomNowPlaying: Track | null;
  currentTime: number;
  duration: number;
  isHost: boolean;
  isPlaying: boolean;
  toggleRoomPlayback: () => void;
  handlePlayNext: () => void;
  syncStatus: "idle" | "synced" | "drifting";
  syncPlaybackState: () => void;
  roomIsActive: boolean;
  isConnected: boolean;
  queueItems: JamQueueItem[];
}

type JamNowPlayingTrackProps = Pick<
  JamNowPlayingProps,
  "t" | "roomNowPlaying" | "currentTime" | "duration"
>;

type JamPlaybackControlsProps = Pick<
  JamNowPlayingProps,
  | "t"
  | "isHost"
  | "isPlaying"
  | "toggleRoomPlayback"
  | "handlePlayNext"
  | "syncStatus"
  | "syncPlaybackState"
  | "roomIsActive"
  | "isConnected"
  | "roomNowPlaying"
  | "queueItems"
>;

function JamNowPlayingTrack(props: JamNowPlayingTrackProps) {
  const { t, roomNowPlaying, currentTime, duration } = props;

  return (
    <div className="flex min-w-0 items-center gap-4">
      {roomNowPlaying?.albumCover ? (
        <CrateImage
          src={roomNowPlaying.albumCover}
          alt=""
          className="jam-artwork-shadow size-16 shrink-0 rounded-lg object-cover sm:size-20"
        />
      ) : (
        <div className="jam-artwork-placeholder flex size-16 shrink-0 items-center justify-center rounded-lg sm:size-20">
          <ListMusic size={22} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="jam-accent-text text-xs uppercase tracking-[0.16em]">
          {t("jam.room.nowPlaying")}
        </div>
        {roomNowPlaying ? (
          <>
            <div className="mt-1 truncate text-lg font-semibold text-text-primary sm:text-xl">
              {roomNowPlaying.title}
            </div>
            <div className="truncate text-sm text-text-muted">
              {roomNowPlaying.artist}
              {roomNowPlaying.album ? ` · ${roomNowPlaying.album}` : ""}
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-text-muted">
            {t("jam.toasts.roomQueueEmpty")}
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <div className="jam-progress-track h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
            <div
              className="jam-progress-fill jam-progress-fill-dynamic h-full rounded-full"
              style={
                {
                  "--progress-scale":
                    duration > 0
                      ? Math.min(1, Math.max(0, currentTime / duration))
                      : 0,
                } as CSSProperties
              }
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-text-muted">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

type JamHostPlaybackControlsProps = Pick<
  JamPlaybackControlsProps,
  | "t"
  | "isPlaying"
  | "toggleRoomPlayback"
  | "handlePlayNext"
  | "syncStatus"
  | "syncPlaybackState"
  | "roomIsActive"
  | "isConnected"
  | "roomNowPlaying"
  | "queueItems"
>;

function JamHostPlaybackControls({
  t,
  isPlaying,
  toggleRoomPlayback,
  handlePlayNext,
  syncStatus,
  syncPlaybackState,
  roomIsActive,
  isConnected,
  roomNowPlaying,
  queueItems,
}: JamHostPlaybackControlsProps) {
  return (
    <>
      <HeroActionButton
        label={
          isPlaying
            ? t("jam.room.actions.pauseRoom")
            : t("jam.room.actions.playRoom")
        }
        onClick={toggleRoomPlayback}
        disabled={!roomIsActive || !isConnected}
        className=" size-12 jam-accent-chip"
      >
        {isPlaying ? <Pause size={20} /> : <Play size={20} />}
      </HeroActionButton>
      <HeroActionButton
        label={t("jam.room.actions.playNextTrack")}
        onClick={handlePlayNext}
        disabled={!roomIsActive || !isConnected || queueItems.length === 0}
        className=" size-12"
      >
        <SkipForward size={19} />
      </HeroActionButton>
      <HeroActionButton
        label={
          syncStatus === "synced"
            ? t("jam.room.actions.resyncPlayback")
            : t("jam.room.actions.syncPlayback")
        }
        onClick={syncPlaybackState}
        disabled={!roomIsActive || !isConnected || !roomNowPlaying}
        className={` size-12 ${
          syncStatus === "synced" ? "jam-success-chip" : ""
        }`}
      >
        <Zap size={19} />
      </HeroActionButton>
    </>
  );
}

function JamGuestPlaybackStatus({
  t,
  syncStatus,
}: Pick<JamPlaybackControlsProps, "t" | "syncStatus">) {
  return (
    <div
      title={
        syncStatus === "synced"
          ? t("jam.room.syncedWithHost")
          : syncStatus === "drifting"
            ? t("jam.room.catchingUp")
            : t("jam.room.waitingForHost")
      }
      className="jam-chip inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs text-text-muted"
    >
      <Zap size={15} className="jam-accent-text" />
      {syncStatus === "synced"
        ? t("jam.room.synced")
        : t("jam.room.waitingForHost")}
    </div>
  );
}

function JamPlaybackControls(props: JamPlaybackControlsProps) {
  const { isHost } = props;

  return (
    <div className="flex items-center gap-2 md:justify-end">
      {isHost ? (
        <JamHostPlaybackControls {...props} />
      ) : (
        <JamGuestPlaybackStatus {...props} />
      )}
    </div>
  );
}

export function JamNowPlaying(props: JamNowPlayingProps) {
  return (
    <div className="jam-now-playing grid min-w-0 gap-4 rounded-xl p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5">
      <JamNowPlayingTrack {...props} />
      <JamPlaybackControls {...props} />
    </div>
  );
}
