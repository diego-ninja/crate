import type { PlaySource, Track } from "@/contexts/PlayerContext";
import {
  toRadioTrack,
  toShapedRadioTrack,
  type RadioTrackPayload,
  type ShapedRadioTrack,
} from "./radio-model";
import { ApiError, api } from "@/lib/api";
import { getPlaySourceLabel } from "@/components/player/player-source";

export type { RadioTrackPayload, ShapedRadioTrack } from "./radio-model";

interface RadioResponse {
  session?: {
    type?: "track" | "album" | "artist" | "playlist";
    name?: string;
    seed?: {
      track_id?: number | null;
      track_entity_uid?: string | null;
      track_path?: string | null;
      artist_id?: number | null;
      artist_name?: string | null;
      album_id?: number | null;
      playlist_id?: number | null;
    };
  };
  tracks: RadioTrackPayload[];
}

interface RadioRequestOptions {
  signal?: AbortSignal;
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function requestRadio(
  url: string,
  options: RadioRequestOptions = {},
): Promise<RadioResponse> {
  try {
    return await api<RadioResponse>(url, "GET", undefined, {
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { tracks: [] };
    }
    throw error;
  }
}

async function startSeededRadioSession(
  seedType:
    | "artist"
    | "album"
    | "track"
    | "playlist"
    | "home-playlist"
    | "genre",
  seedValue: string,
  seedLabel: string,
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const data = await api<ShapedRadioStartResponse>(
    "/api/radio/start",
    "POST",
    {
      mode: "seeded",
      seed_type: seedType,
      seed_value: seedValue,
    },
    { signal: options.signal },
  );
  return {
    tracks: data.tracks.map(toShapedRadioTrack),
    source: {
      type: "radio",
      name:
        getPlaySourceLabel({
          type: "radio",
          name: `${data.seed_label || seedLabel} Radio`,
          radio: {
            seedType,
            seedId: Number.isNaN(Number(seedValue))
              ? seedValue
              : Number(seedValue),
            shapedSessionId: data.session_id,
          },
        }) || `${data.seed_label || seedLabel} Radio`,
      radio: {
        seedType,
        seedId: Number.isNaN(Number(seedValue)) ? seedValue : Number(seedValue),
        shapedSessionId: data.session_id,
      },
    },
  };
}

export async function fetchArtistRadio(
  artistId: number | string,
  artistName: string,
  limit = 50,
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  void limit;
  return startSeededRadioSession(
    "artist",
    String(artistId),
    artistName,
    options,
  );
}

export async function fetchTrackRadio(
  seed: {
    libraryTrackId?: number | null;
    globalTrackUid?: string | null;
    entityUid?: string | null;
    path?: string | null;
    title: string;
  },
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const seedValue =
    seed.libraryTrackId != null
      ? String(seed.libraryTrackId)
      : seed.globalTrackUid || seed.entityUid || seed.path;
  if (!seedValue) {
    throw new Error(
      "track radio requires libraryTrackId, globalTrackUid, entityUid or path",
    );
  }
  return startSeededRadioSession("track", seedValue, seed.title, options);
}

export async function fetchAlbumRadio(
  seed: {
    albumId: number | string;
    artistName: string;
    albumName: string;
  },
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession(
    "album",
    String(seed.albumId),
    seed.albumName,
    options,
  );
}

export async function fetchPlaylistRadio(
  seed: {
    playlistId: number;
    playlistName: string;
  },
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession(
    "playlist",
    String(seed.playlistId),
    seed.playlistName,
    options,
  );
}

export async function fetchHomePlaylistRadio(
  seed: {
    playlistId: string;
    playlistName: string;
  },
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession(
    "home-playlist",
    seed.playlistId,
    seed.playlistName,
    options,
  );
}

export async function fetchRadioContinuation(
  source: PlaySource,
  limit = 30,
  options: RadioRequestOptions = {},
): Promise<Track[]> {
  const radio = source.radio;
  if (!radio) return [];

  if (radio.shapedSessionId) {
    return fetchShapedRadioNext(radio.shapedSessionId, limit, options);
  }

  if (radio.seedType === "artist" && radio.seedId) {
    if (typeof radio.seedId !== "number") return [];
    const data = await requestRadio(
      `/api/artists/${radio.seedId}/radio?limit=${limit}`,
      options,
    );
    return (data.tracks || []).map(toRadioTrack);
  }

  if (radio.seedType === "track") {
    const params = new URLSearchParams({ limit: String(limit) });
    const legacySeedStorageId = (radio as { seedStorageId?: string | null })
      .seedStorageId;
    if (radio.seedEntityUid) {
      params.set("entity_uid", radio.seedEntityUid);
    } else if (typeof radio.seedId === "number") {
      params.set("track_id", String(radio.seedId));
    } else if (
      typeof radio.seedId === "string" &&
      looksLikeUuid(radio.seedId)
    ) {
      params.set("entity_uid", radio.seedId);
    } else if (typeof radio.seedId === "string" && radio.seedId.includes("/")) {
      params.set("path", radio.seedId);
    } else if (radio.seedPath) {
      params.set("path", radio.seedPath);
    } else if (legacySeedStorageId) {
      // Compatibility for persisted legacy radio sessions. New sessions should
      // always carry an entity UID, path, or numeric library track id instead.
      params.set("storage_id", legacySeedStorageId);
    } else if (radio.seedId != null) {
      return [];
    } else {
      return [];
    }
    const data = await requestRadio(
      `/api/radio/track?${params.toString()}`,
      options,
    );
    return (data.tracks || []).map(toRadioTrack);
  }

  if (radio.seedType === "album" && radio.seedId != null) {
    const data = await requestRadio(
      `/api/radio/album/${radio.seedId}?limit=${limit}`,
      options,
    );
    return (data.tracks || []).map(toRadioTrack);
  }

  if (radio.seedType === "playlist" && radio.seedId != null) {
    const path =
      typeof radio.seedId === "number"
        ? `/api/radio/playlist/${radio.seedId}?limit=${limit}`
        : `/api/radio/home-playlist/${encodeURIComponent(
            String(radio.seedId),
          )}?limit=${limit}`;
    const data = await requestRadio(path, options);
    return (data.tracks || []).map(toRadioTrack);
  }

  return [];
}

export async function fetchInfiniteContinuation(
  source: PlaySource,
  limit = 30,
  options: RadioRequestOptions = {},
): Promise<Track[]> {
  const seed = source.radio;
  if (!seed) return [];

  if (
    source.type === "album" &&
    seed.seedType === "album" &&
    seed.seedId != null
  ) {
    const data = await requestRadio(
      `/api/radio/album/${seed.seedId}?limit=${limit}`,
      options,
    );
    return (data.tracks || []).map(toRadioTrack);
  }

  if (
    source.type === "playlist" &&
    seed.seedType === "playlist" &&
    seed.seedId != null
  ) {
    const path =
      typeof seed.seedId === "number"
        ? `/api/radio/playlist/${seed.seedId}?limit=${limit}`
        : `/api/radio/home-playlist/${encodeURIComponent(
            String(seed.seedId),
          )}?limit=${limit}`;
    const data = await requestRadio(path, options);
    return (data.tracks || []).map(toRadioTrack);
  }

  return [];
}

// ── Shaped Radio (v2) — sessions with like/dislike feedback ────────

interface ShapedRadioStartResponse {
  session_id: string;
  mode: string;
  seed_label: string;
  tracks: ShapedRadioTrack[];
}

interface ShapedRadioNextResponse {
  session_id: string;
  tracks: ShapedRadioTrack[];
}

export async function startShapedRadio(
  mode: "seeded" | "discovery",
  seedType?: string,
  seedValue?: string,
): Promise<{
  sessionId: string;
  seedLabel: string;
  tracks: Track[];
  source: PlaySource;
} | null> {
  try {
    const data = await api<ShapedRadioStartResponse>(
      "/api/radio/start",
      "POST",
      {
        mode,
        seed_type: seedType,
        seed_value: seedValue,
      },
    );
    return {
      sessionId: data.session_id,
      seedLabel: data.seed_label,
      tracks: data.tracks.map(toShapedRadioTrack),
      source: {
        type: "radio",
        name:
          mode === "discovery" ? "Discovery Radio" : `${data.seed_label} Radio`,
        radio: {
          seedType: (seedType || "discovery") as
            | "track"
            | "album"
            | "artist"
            | "playlist"
            | "home-playlist"
            | "genre"
            | "discovery",
          seedId: seedValue
            ? isNaN(Number(seedValue))
              ? seedValue
              : Number(seedValue)
            : null,
          shapedSessionId: data.session_id,
        },
      },
    };
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.status === 422)
    ) {
      return null;
    }
    throw error;
  }
}

export async function fetchShapedRadioNext(
  sessionId: string,
  count = 5,
  options: RadioRequestOptions = {},
): Promise<Track[]> {
  try {
    const data = await api<ShapedRadioNextResponse>(
      "/api/radio/next",
      "POST",
      {
        session_id: sessionId,
        count,
      },
      { signal: options.signal },
    );
    return data.tracks.map(toShapedRadioTrack);
  } catch {
    return [];
  }
}

export async function sendRadioFeedback(
  sessionId: string,
  trackId: number | undefined,
  action: "like" | "dislike",
  globalTrackUid?: string,
): Promise<void> {
  try {
    await api("/api/radio/feedback", "POST", {
      session_id: sessionId,
      ...(trackId !== undefined ? { track_id: trackId } : {}),
      ...(globalTrackUid ? { global_track_uid: globalTrackUid } : {}),
      action,
    });
  } catch {
    // silent fail — feedback is best-effort
  }
}

export async function checkDiscoveryAvailable(): Promise<boolean> {
  try {
    const data = await api<{ available: boolean }>("/api/radio/can-discover");
    return data.available;
  } catch {
    return false;
  }
}
