import type { PlaySource, Track } from "@/contexts/PlayerContext";
import { ApiError, api } from "@/lib/api";
import { encPath } from "@/lib/utils";

export interface RadioTrackPayload {
  track_id?: number | null;
  navidrome_id?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
  score?: number | null;
}

interface RadioResponse {
  session?: {
    type?: "track" | "album" | "artist" | "playlist";
    name?: string;
    seed?: {
      track_id?: number | null;
      track_path?: string | null;
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
  const navidromeId = payload.navidrome_id || undefined;
  const playbackId =
    trackPath ||
    navidromeId ||
    (payload.track_id != null
      ? String(payload.track_id)
      : `radio:${payload.artist || "unknown"}:${payload.album || "unknown"}:${payload.title || "unknown"}`);

  return {
    id: playbackId,
    title: payload.title || "Unknown",
    artist: payload.artist || "Unknown",
    album: payload.album || undefined,
    albumCover: payload.artist && payload.album
      ? `/api/cover/${encPath(payload.artist)}/${encPath(payload.album)}`
      : undefined,
    path: trackPath || undefined,
    navidromeId,
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

export async function fetchArtistRadio(artistName: string, limit = 50, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const data = await requestRadio(`/api/radio/artist/${encPath(artistName)}?limit=${limit}`, options);
  return {
    tracks: (data.tracks || []).map(toTrack),
    source: {
      type: "radio",
      name: data.session?.name || `${artistName} Radio`,
      radio: {
        seedType: "artist",
        seedId: data.session?.seed?.artist_name || artistName,
      },
    },
  };
}

export async function fetchTrackRadio(seed: {
  libraryTrackId?: number | null;
  path?: string | null;
  title: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const params = new URLSearchParams();
  if (seed.libraryTrackId != null) {
    params.set("track_id", String(seed.libraryTrackId));
  } else if (seed.path) {
    params.set("path", seed.path);
  } else {
    throw new Error("track radio requires libraryTrackId or path");
  }
  params.set("limit", "50");

  const data = await requestRadio(`/api/radio/track?${params.toString()}`, options);
  return {
    tracks: (data.tracks || []).map(toTrack),
    source: {
      type: "radio",
      name: data.session?.name || `${seed.title} Radio`,
      radio: {
        seedType: "track",
        seedId: data.session?.seed?.track_id ?? seed.libraryTrackId ?? null,
        seedPath: data.session?.seed?.track_path ?? seed.path ?? null,
      },
    },
  };
}

export async function fetchAlbumRadio(seed: {
  albumId: number;
  artistName: string;
  albumName: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const data = await requestRadio(`/api/radio/album/${seed.albumId}?limit=50`, options);
  return {
    tracks: (data.tracks || []).map(toTrack),
    source: {
      type: "radio",
      name: data.session?.name || `${seed.albumName} Radio`,
      radio: {
        seedType: "album",
        seedId: data.session?.seed?.album_id ?? seed.albumId,
      },
    },
  };
}

export async function fetchPlaylistRadio(seed: {
  playlistId: number;
  playlistName: string;
}, options: RadioRequestOptions = {}): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const data = await requestRadio(`/api/radio/playlist/${seed.playlistId}?limit=50`, options);
  return {
    tracks: (data.tracks || []).map(toTrack),
    source: {
      type: "radio",
      name: data.session?.name || `${seed.playlistName} Radio`,
      radio: {
        seedType: "playlist",
        seedId: data.session?.seed?.playlist_id ?? seed.playlistId,
      },
    },
  };
}

export async function fetchRadioContinuation(
  source: PlaySource,
  limit = 30,
  options: RadioRequestOptions = {},
): Promise<Track[]> {
  const radio = source.radio;
  if (!radio) return [];

  if (radio.seedType === "artist" && radio.seedId) {
    const data = await requestRadio(`/api/radio/artist/${encPath(String(radio.seedId))}?limit=${limit}`, options);
    return (data.tracks || []).map(toTrack);
  }

  if (radio.seedType === "track") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (radio.seedId != null) {
      params.set("track_id", String(radio.seedId));
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
    const data = await requestRadio(`/api/radio/playlist/${radio.seedId}?limit=${limit}`, options);
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
    const data = await requestRadio(`/api/radio/playlist/${seed.seedId}?limit=${limit}`, options);
    return (data.tracks || []).map(toTrack);
  }

  return [];
}
