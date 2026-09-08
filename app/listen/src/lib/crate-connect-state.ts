import type {
  CompactTrackReference,
  RemotePlaybackState,
} from "@/lib/remote-playback-state";

export type ConnectPlayerState = Record<string, unknown> & {
  session_id?: string | null;
  active_instance_id?: string | null;
  active_device_id?: string | null;
  active_device_label?: string | null;
  status?: string | null;
  position_ms?: number | null;
  position_updated_at?: string | null;
  version?: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactTrackFromRecord(
  value: unknown,
  index: number,
): CompactTrackReference | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = stringValue(record.title, "");
  const artist = stringValue(record.artist, "");
  if (!title && !artist) return null;
  return {
    album: optionalString(record.album),
    album_cover: optionalString(record.album_cover),
    artist,
    duration: optionalNumber(record.duration),
    path: optionalString(record.path),
    title: title || `Track ${index + 1}`,
    track_entity_uid: optionalString(record.track_entity_uid),
    track_id: optionalNumber(record.track_id),
  };
}

function compactQueue(value: unknown): CompactTrackReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(compactTrackFromRecord)
    .filter((track): track is CompactTrackReference => Boolean(track));
}

function trackFromState(
  state: ConnectPlayerState,
  queue: CompactTrackReference[],
): CompactTrackReference | null {
  const currentIndex = Math.max(
    0,
    Math.round(numberValue(state.current_index)),
  );
  const queuedTrack = queue[currentIndex];
  if (queuedTrack) return queuedTrack;
  const rawTrack = asRecord(state.track);
  if (rawTrack) {
    return {
      album: optionalString(rawTrack.album),
      album_cover: optionalString(rawTrack.album_cover),
      artist: stringValue(rawTrack.artist, ""),
      duration:
        typeof rawTrack.duration_ms === "number"
          ? rawTrack.duration_ms / 1000
          : optionalNumber(rawTrack.duration),
      path: optionalString(rawTrack.path),
      title: stringValue(rawTrack.title, ""),
      track_entity_uid: optionalString(rawTrack.entity_uid),
      track_id: optionalNumber(rawTrack.id),
    };
  }
  if (state.track_entity_uid || state.track_id || state.track_path) {
    return {
      album: stringValue(state.album, ""),
      album_cover: optionalString(state.album_cover),
      artist: stringValue(state.artist, ""),
      duration:
        typeof state.duration_ms === "number"
          ? state.duration_ms / 1000
          : undefined,
      path: optionalString(state.track_path),
      title: stringValue(state.title, ""),
      track_entity_uid: optionalString(state.track_entity_uid),
      track_id: optionalNumber(state.track_id),
    };
  }
  return null;
}

function normalizedRepeat(value: unknown): RemotePlaybackState["repeat_mode"] {
  return value === "one" || value === "all" ? value : "off";
}

export function connectPlayerStateToRemotePlaybackState(
  state: ConnectPlayerState | null | undefined,
): RemotePlaybackState | null {
  if (!state) return null;
  const queue = compactQueue(state.queue);
  const track = trackFromState(state, queue);
  if (!track) return null;
  const durationMs =
    typeof state.duration_ms === "number"
      ? state.duration_ms
      : typeof track.duration === "number"
        ? Math.round(track.duration * 1000)
        : undefined;
  return {
    album: track.album || stringValue(state.album, ""),
    album_cover: track.album_cover || optionalString(state.album_cover),
    app_platform: optionalString(state.app_platform),
    artist: track.artist || stringValue(state.artist, ""),
    current_index: Math.max(0, Math.round(numberValue(state.current_index))),
    device_id:
      optionalString(state.active_device_id) ||
      optionalString(state.device_id) ||
      "",
    device_label: optionalString(state.active_device_label),
    device_type: optionalString(state.device_type),
    duration_ms: durationMs,
    expires_at: optionalString(state.expires_at),
    play_source: asRecord(
      state.play_source,
    ) as RemotePlaybackState["play_source"],
    position_ms: Math.max(0, Math.round(numberValue(state.position_ms))),
    position_updated_at: optionalString(state.position_updated_at),
    queue: queue.length ? queue : [track],
    queue_revision: optionalString(state.queue_revision),
    repeat_mode: normalizedRepeat(state.repeat ?? state.repeat_mode),
    shuffle: Boolean(state.shuffle),
    status: stringValue(state.status, "paused"),
    title: track.title || stringValue(state.title, ""),
    track_entity_uid:
      track.track_entity_uid || optionalString(state.track_entity_uid),
    track_id: track.track_id ?? optionalNumber(state.track_id) ?? null,
    track_path: track.path || optionalString(state.track_path),
    unshuffled_queue:
      state.unshuffled_queue === null
        ? null
        : compactQueue(state.unshuffled_queue),
    updated_at: optionalString(state.updated_at),
  };
}
