import type { PlaySource, Track } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
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
    };
  };
  tracks: RadioTrackPayload[];
}

function toTrack(payload: RadioTrackPayload): Track {
  const trackPath = payload.track_path || "";
  const navidromeId = payload.navidrome_id || undefined;
  const playbackId = trackPath || navidromeId || String(payload.track_id || "");

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

export async function fetchArtistRadio(artistName: string, limit = 50): Promise<{
  tracks: Track[];
  source: PlaySource;
}> {
  const data = await api<RadioResponse>(`/api/radio/artist/${encPath(artistName)}?limit=${limit}`);
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
}): Promise<{
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

  const data = await api<RadioResponse>(`/api/radio/track?${params.toString()}`);
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
