import { useEffect, useRef } from "react";

import { type Track, usePlayerActions } from "@/contexts/PlayerContext";
import type { PlayerActionsValue } from "@/contexts/player-context";
import type { JamQueueItem } from "@/pages/jam-reducer";
import { PLAYER_TRACK_FINISHED_EVENT } from "@/contexts/player-events";
import { tracksMatch as playerTracksMatch } from "@/contexts/player-session";
import { trackIdentity, trackToPayload } from "@/pages/jam-session-utils";

type PlayerActions = Pick<
  PlayerActionsValue,
  "pause" | "resume" | "seek" | "currentTrack"
> & { isPlaying: boolean };

export interface UseJamPlaybackEffectsOptions {
  roomId: string | undefined;
  roomIsActive: boolean;
  isConnected: boolean;
  isHost: boolean;
  isPlaying: boolean;
  currentTrack: Track | undefined;
  roomCurrentTrack: Track | null;
  queueItems: JamQueueItem[];
  currentTime: number;
  duration: number;
  playerActionsRef: { current: PlayerActions };
  currentTimeRef: { current: number };
  sendEvent: (payload: Record<string, unknown>) => boolean;
  setSyncStatus: (status: "idle" | "synced" | "drifting") => void;
}

export function useJamPlaybackEffects({
  roomId,
  roomIsActive,
  isConnected,
  isHost,
  isPlaying,
  currentTrack,
  roomCurrentTrack,
  queueItems,
  currentTime,
  duration,
  playerActionsRef,
  currentTimeRef,
  sendEvent,
  setSyncStatus,
}: UseJamPlaybackEffectsOptions) {
  const { setJamTransport } = usePlayerActions();
  useEffect(() => {
    if (!roomId || !roomIsActive || !isConnected) {
      setJamTransport(null);
      return;
    }

    setJamTransport({
      canControl: isHost,
      togglePlayPause: () => {
        if (!isHost) return;
        const actions = playerActionsRef.current;
        const activeTrack = roomCurrentTrack || actions.currentTrack;
        const position = currentTimeRef.current;

        if (!activeTrack) {
          const tracks = queueItems.map((item) => item.track);
          if (tracks.length === 0) return;
          sendEvent({ type: "queue_play" });
          return;
        }

        const playing = !actions.isPlaying;
        if (
          !sendEvent({
            type: playing ? "play" : "pause",
            track: trackToPayload(activeTrack),
            position,
            playing,
          })
        ) {
          return;
        }
        if (playing) actions.resume();
        else actions.pause();
        setSyncStatus(playing ? "synced" : "idle");
      },
      next: () => {
        if (!isHost || queueItems.length === 0) return;
        sendEvent({ type: "play_next" });
      },
      previous: () => {
        // Jam playback is intentionally forward-only. The host can choose
        // the next item from the shared queue, but cannot move a member back
        // through a private local history.
      },
      seek: (time: number) => {
        if (!isHost) return;
        const activeTrack =
          roomCurrentTrack || playerActionsRef.current.currentTrack;
        if (!activeTrack) return;
        const position = Math.max(0, time);
        if (
          !sendEvent({
            type: "seek",
            track: trackToPayload(activeTrack),
            position,
            playing: playerActionsRef.current.isPlaying,
          })
        ) {
          return;
        }
        playerActionsRef.current.seek(position);
      },
    });

    return () => setJamTransport(null);
  }, [
    isConnected,
    isHost,
    queueItems,
    roomId,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
    setJamTransport,
    setSyncStatus,
    playerActionsRef,
    currentTimeRef,
  ]);

  const advanceTrackRef = useRef<string | null>(null);
  const transitionAdvanceRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !isHost ||
      !roomIsActive ||
      !isPlaying ||
      !roomCurrentTrack?.id ||
      !duration ||
      duration <= 0
    ) {
      if (currentTime < Math.max(0, (duration || 0) - 2)) {
        advanceTrackRef.current = null;
      }
      return;
    }
    if (
      currentTime >= duration - 0.75 &&
      advanceTrackRef.current !== trackIdentity(roomCurrentTrack)
    ) {
      advanceTrackRef.current = trackIdentity(roomCurrentTrack);
      sendEvent({ type: "play_next" });
    }
  }, [
    currentTime,
    duration,
    isHost,
    isPlaying,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
  ]);

  useEffect(() => {
    if (
      !isHost ||
      !roomIsActive ||
      !isConnected ||
      !roomCurrentTrack ||
      !currentTrack
    ) {
      return;
    }

    if (playerTracksMatch(currentTrack, roomCurrentTrack)) {
      transitionAdvanceRef.current = null;
      return;
    }

    const roomTrackIndex = queueItems.findIndex((item) =>
      playerTracksMatch(item.track, roomCurrentTrack),
    );
    const playerTrackIndex = queueItems.findIndex((item) =>
      playerTracksMatch(item.track, currentTrack),
    );
    if (roomTrackIndex < 0 || playerTrackIndex !== roomTrackIndex + 1) {
      return;
    }

    const transitionKey = `${trackIdentity(roomCurrentTrack)}->${trackIdentity(
      currentTrack,
    )}`;
    if (transitionAdvanceRef.current === transitionKey) return;
    if (sendEvent({ type: "play_next" })) {
      transitionAdvanceRef.current = transitionKey;
    }
  }, [
    currentTrack,
    isConnected,
    isHost,
    queueItems,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleTrackFinished(event: Event) {
      const detail = (event as CustomEvent<{ track?: Track }>).detail;
      if (
        !isHost ||
        !roomIsActive ||
        !isConnected ||
        !roomCurrentTrack ||
        !playerTracksMatch(detail?.track, roomCurrentTrack)
      ) {
        return;
      }

      if (!sendEvent({ type: "play_next" })) return;

      const roomTrackIndex = queueItems.findIndex((item) =>
        playerTracksMatch(item.track, roomCurrentTrack),
      );
      const nextTrack = queueItems[roomTrackIndex + 1]?.track;
      transitionAdvanceRef.current = nextTrack
        ? `${trackIdentity(roomCurrentTrack)}->${trackIdentity(nextTrack)}`
        : null;
      advanceTrackRef.current = trackIdentity(roomCurrentTrack);
    }

    window.addEventListener(PLAYER_TRACK_FINISHED_EVENT, handleTrackFinished);
    return () => {
      window.removeEventListener(
        PLAYER_TRACK_FINISHED_EVENT,
        handleTrackFinished,
      );
    };
  }, [
    isConnected,
    isHost,
    queueItems,
    roomCurrentTrack,
    roomIsActive,
    sendEvent,
  ]);
}
