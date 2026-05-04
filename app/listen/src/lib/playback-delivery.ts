import type { Track } from "@/contexts/player-types";
import { apiFetch } from "@/lib/api";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";

const DESKTOP_PREPARE_WINDOW = 5;
const MOBILE_PREPARE_WINDOW = 3;
const SAVE_DATA_PREPARE_WINDOW = 2;
let lastPrepareKey = "";

type NavigatorWithConnection = Navigator & {
  connection?: {
    saveData?: boolean;
  };
};

function numericTrackId(track: Track): number | null {
  if (track.libraryTrackId != null) return track.libraryTrackId;
  if (/^\d+$/.test(track.id)) return Number(track.id);
  return null;
}

function trackRef(track: Track) {
  return {
    track_id: numericTrackId(track),
    entity_uid: track.entityUid ?? null,
    path: track.path ?? null,
  };
}

function runtimePrepareWindow(): number {
  if (typeof window === "undefined") return DESKTOP_PREPARE_WINDOW;
  const navigatorWithConnection = navigator as NavigatorWithConnection;
  if (navigatorWithConnection.connection?.saveData) return SAVE_DATA_PREPARE_WINDOW;
  if (window.matchMedia?.("(max-width: 767px)").matches) return MOBILE_PREPARE_WINDOW;
  return DESKTOP_PREPARE_WINDOW;
}

export function upcomingDeliveryTracks(
  queue: Track[],
  currentIndex: number,
  prepareWindow = DESKTOP_PREPARE_WINDOW,
): Track[] {
  if (queue.length === 0) return [];
  const start = Math.max(0, Math.min(currentIndex, queue.length - 1));
  return queue.slice(start, start + Math.max(1, prepareWindow));
}

export function preparePlaybackDelivery(
  queue: Track[],
  currentIndex: number,
  policy: PlaybackDeliveryPolicy,
): void {
  if (typeof window === "undefined") return;
  if (policy === "original") return;
  const tracks = upcomingDeliveryTracks(queue, currentIndex, runtimePrepareWindow());
  if (tracks.length === 0) return;

  const refs = tracks
    .map(trackRef)
    .filter((ref) => ref.entity_uid || ref.track_id || ref.path);
  if (refs.length === 0) return;

  const key = JSON.stringify({ policy, refs });
  if (key === lastPrepareKey) return;
  lastPrepareKey = key;

  window.setTimeout(() => {
    void apiFetch("/api/playback/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy, tracks: refs }),
    }).catch(() => {
      if (lastPrepareKey === key) {
        lastPrepareKey = "";
      }
    });
  }, 250);
}
