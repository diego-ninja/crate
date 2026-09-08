import type { OfflineItemRecord, OfflineItemState } from "@/lib/offline";
import type { Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { getOfflineStateLabel, isOfflineBusy } from "@/lib/offline";

export interface PlaylistTrackResponse {
  track_id?: number;
  track_entity_uid?: string;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  album_slug?: string;
  duration: number;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
}

export interface PlaylistDetailResponse {
  tracks: PlaylistTrackResponse[];
}

export interface PlaylistOfflinePresentation {
  meta: string | null;
  toneClass: string;
}

export function toPlayerTracks(tracks: PlaylistTrackResponse[]): Track[] {
  return tracks.map((track) =>
    toPlayableTrack(
      {
        ...track,
        id: track.track_id ?? track.track_entity_uid ?? track.track_path,
        entity_uid: track.track_entity_uid,
        path: track.track_path,
        library_track_id: track.track_id,
      },
      {
        cover:
          track.artist && track.album
            ? albumCoverApiUrl(
                {
                  albumId: track.album_id,
                  albumEntityUid: track.album_entity_uid,
                  artistEntityUid: track.artist_entity_uid,
                  albumSlug: track.album_slug,
                  artistName: track.artist,
                  albumName: track.album,
                },
                { size: 512 },
              )
            : undefined,
      },
    ),
  );
}

export function getPlaylistOfflinePresentation(
  state: OfflineItemState,
  record?: OfflineItemRecord | null,
): PlaylistOfflinePresentation {
  if (state === "ready") {
    return {
      meta: record?.trackCount
        ? `${record.trackCount} offline`
        : getOfflineStateLabel(state),
      toneClass: "text-text-accent/90",
    };
  }

  if (isOfflineBusy(state) && record?.trackCount) {
    return {
      meta: `${Math.min(record.readyTrackCount || 0, record.trackCount)}/${
        record.trackCount
      } offline`,
      toneClass: "text-accent-action",
    };
  }

  return {
    meta: getOfflineStateLabel(state),
    toneClass: state === "error" ? "text-state-warning-text/90" : "",
  };
}

export function getPlaylistBadgeLabel(
  crateManaged: boolean,
  badge?: "smart" | "curated" | "personal",
): string | null {
  if (crateManaged) return null;
  if (badge === "smart") return "Smart";
  if (badge === "curated") return "Curated";
  return null;
}
