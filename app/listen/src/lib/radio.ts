import type { PlaySource, Track } from "@/contexts/PlayerContext";
import { ApiError, api } from "@/lib/api";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";

export interface RadioTrackPayload {
  track_id?: number | null;
  track_storage_id?: string | null;
  track_slug?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  duration?: number | null;
  score?: number | null;
}

interface RadioResponse {
  session?: {
    type?: "track" | "album" | "artist" | "playlist";
    name?: string;
    seed?: {
      track_id?: number | null;
      track_storage_id?: string | null;
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

function toTrack(payload: RadioTrackPayload): Track {
  const trackPath = payload.track_path || "";
  const playbackId =
    payload.track_storage_id ||
    trackPath ||
    (payload.track_id != null
      ? String(payload.track_id)
      : `radio:${payload.artist || "unknown"}:${payload.album || "unknown"}:${payload.title || "unknown"}`);

  return {
    id: playbackId,
    storageId: payload.track_storage_id || undefined,
    title: payload.title || "Unknown",
    artist: payload.artist || "Unknown",
    artistId: payload.artist_id || undefined,
    artistSlug: payload.artist_slug || undefined,
    album: payload.album || undefined,
    albumId: payload.album_id || undefined,
    albumSlug: payload.album_slug || undefined,
    albumCover: payload.album
      ? albumCoverApiUrl({
          albumId: payload.album_id,
          albumSlug: payload.album_slug,
          artistName: payload.artist,
          albumName: payload.album,
        }, { size: 512 }) || artistPhotoApiUrl({
          artistId: payload.artist_id,
          artistSlug: payload.artist_slug,
          artistName: payload.artist,
        }, { size: 512 }) || undefined
      : artistPhotoApiUrl({
          artistId: payload.artist_id,
          artistSlug: payload.artist_slug,
          artistName: payload.artist,
        }, { size: 512 }) || undefined,
    path: trackPath || undefined,
    libraryTrackId: payload.track_id || undefined,
  };
}

async function requestRadio(url: string, options: RadioRequestOptions = {}): Promise<RadioResponse> {
  try {
    return await api<RadioResponse>(url, "GET", undefined, { signal: options.signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { tracks: [] };
    }
    throw error;
  }
}

async function startSeededRadioSession(
  seedType: "artist" | "album" | "track" | "playlist" | "home-playlist" | "genre",
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
    tracks: data.tracks.map(shapedToTrack),
    source: {
      type: "radio",
      name: `${data.seed_label || seedLabel} Radio`,
      radio: {
        seedType,
        seedId: Number.isNaN(Number(seedValue)) ? seedValue : Number(seedValue),
        shapedSessionId: data.session_id,
      },
    },
  };
}

export async function fetchArtistRadio(
  artistId: number,
  artistName: string,
  limit = 50,
  options: RadioRequestOptions = {},
): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  void limit;
  return startSeededRadioSession("artist", String(artistId), artistName, options);
}

export async function fetchTrackRadio(seed: {
  libraryTrackId?: number | null;
  storageId?: string | null;
  path?: string | null;
  title: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const seedValue =
    seed.libraryTrackId != null
      ? String(seed.libraryTrackId)
      : seed.storageId || seed.path;
  if (!seedValue) {
    throw new Error("track radio requires libraryTrackId, storageId or path");
  }
  return startSeededRadioSession("track", seedValue, seed.title, options);
}

export async function fetchAlbumRadio(seed: {
  albumId: number;
  artistName: string;
  albumName: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession("album", String(seed.albumId), seed.albumName, options);
}

export async function fetchPlaylistRadio(seed: {
  playlistId: number;
  playlistName: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession("playlist", String(seed.playlistId), seed.playlistName, options);
}

export async function fetchHomePlaylistRadio(seed: {
  playlistId: string;
  playlistName: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  return startSeededRadioSession("home-playlist", seed.playlistId, seed.playlistName, options);
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
    const data = await requestRadio(`/api/artists/${radio.seedId}/radio?limit=${limit}`, options);
    return (data.tracks || []).map(toTrack);
  }

  if (radio.seedType === "track") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (radio.seedId != null) {
      params.set("track_id", String(radio.seedId));
    } else if (radio.seedStorageId) {
      params.set("storage_id", radio.seedStorageId);
    } else if (radio.seedPath) {
      params.set("path", radio.seedPath);
    } else {
      return [];
    }
    const data = await requestRadio(`/api/radio/track?${params.toString()}`, options);
    return (data.tracks || []).map(toTrack);
  }

  if (radio.seedType === "album" && radio.seedId != null) {
    const data = await requestRadio(`/api/radio/album/${radio.seedId}?limit=${limit}`, options);
    return (data.tracks || []).map(toTrack);
  }

  if (radio.seedType === "playlist" && radio.seedId != null) {
    const path = typeof radio.seedId === "number"
      ? `/api/radio/playlist/${radio.seedId}?limit=${limit}`
      : `/api/radio/home-playlist/${encodeURIComponent(String(radio.seedId))}?limit=${limit}`;
    const data = await requestRadio(path, options);
    return (data.tracks || []).map(toTrack);
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

  if (source.type === "album" && seed.seedType === "album" && seed.seedId != null) {
    const data = await requestRadio(`/api/radio/album/${seed.seedId}?limit=${limit}`, options);
    return (data.tracks || []).map(toTrack);
  }

  if (source.type === "playlist" && seed.seedType === "playlist" && seed.seedId != null) {
    const path = typeof seed.seedId === "number"
      ? `/api/radio/playlist/${seed.seedId}?limit=${limit}`
      : `/api/radio/home-playlist/${encodeURIComponent(String(seed.seedId))}?limit=${limit}`;
    const data = await requestRadio(path, options);
    return (data.tracks || []).map(toTrack);
  }

  return [];
}


// ── Shaped Radio (v2) — sessions with like/dislike feedback ────────

export interface ShapedRadioTrack {
  track_id: number;
  storage_id?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  album_id?: number | null;
  distance: number;
}

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

function shapedToTrack(t: ShapedRadioTrack): Track {
  return {
    id: t.storage_id || String(t.track_id),
    storageId: t.storage_id || undefined,
    title: t.title,
    artist: t.artist,
    album: t.album || undefined,
    albumId: t.album_id || undefined,
    albumCover: t.album_id
      ? albumCoverApiUrl({ albumId: t.album_id }) || undefined
      : undefined,
    libraryTrackId: t.track_id,
  };
}

export async function startShapedRadio(
  mode: "seeded" | "discovery",
  seedType?: string,
  seedValue?: string,
): Promise<{ sessionId: string; seedLabel: string; tracks: Track[]; source: PlaySource } | null> {
  try {
    const data = await api<ShapedRadioStartResponse>("/api/radio/start", "POST", {
      mode,
      seed_type: seedType,
      seed_value: seedValue,
    });
    return {
      sessionId: data.session_id,
      seedLabel: data.seed_label,
      tracks: data.tracks.map(shapedToTrack),
      source: {
        type: "radio",
        name: `${data.seed_label} Radio`,
        radio: {
          seedType: (seedType || "discovery") as "track" | "album" | "artist" | "playlist" | "home-playlist" | "genre" | "discovery",
          seedId: seedValue ? (isNaN(Number(seedValue)) ? seedValue : Number(seedValue)) : null,
          shapedSessionId: data.session_id,
        },
      },
    };
  } catch {
    return null;
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
    return data.tracks.map(shapedToTrack);
  } catch {
    return [];
  }
}

export async function sendRadioFeedback(
  sessionId: string,
  trackId: number,
  action: "like" | "dislike",
): Promise<void> {
  try {
    await api("/api/radio/feedback", "POST", {
      session_id: sessionId,
      track_id: trackId,
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
