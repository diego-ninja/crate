import type { TFunction } from "i18next";

import type { Track } from "@/contexts/PlayerContext";
import type { OfflineItemRecord, OfflineItemState } from "@/lib/offline";
import { isOfflineBusy } from "@/lib/offline";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { formatTotalDuration } from "@/lib/utils";
import type { PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import type { PlaylistData } from "@/pages/playlist-types";

export interface PlaylistOfflinePresentation {
  busy: boolean;
  progress: string | null;
  buttonLabel: string;
  statusDetail: string | null;
}

export function buildPlaylistPlayerTracks(data: PlaylistData | undefined) {
  if (!data?.tracks.length) return [] as Track[];
  return data.tracks.map(
    (track): Track =>
      toPlayableTrack(track, {
        cover:
          track.artist && track.album
            ? albumCoverApiUrl(
                {
                  albumId: track.album_id,
                  albumEntityUid: track.album_entity_uid,
                  globalAlbumUid: track.global_album_uid,
                  artistEntityUid: track.artist_entity_uid,
                  albumSlug: track.album_slug,
                  artistName: track.artist,
                  albumName: track.album,
                },
                { size: 512 },
              )
            : undefined,
      }),
  );
}

export function buildPlaylistEditableTracks(
  data: PlaylistData | undefined,
  t: TFunction,
): PlaylistComposerTrack[] {
  if (!data?.tracks.length) return [];
  return data.tracks.map((track) => ({
    title: track.title || t("common.unknown"),
    artist: track.artist || "",
    album: track.album,
    duration: track.duration,
    path: track.track_path,
    globalTrackUid: track.global_track_uid,
    libraryTrackId: track.track_id,
    entityUid: track.track_entity_uid,
    playlistEntryId: track.id,
    playlistPosition: track.position,
  }));
}

export function buildPlaylistOfflinePresentation(
  data: PlaylistData | undefined,
  offlineState: OfflineItemState,
  offlineRecord: OfflineItemRecord | null,
  t: TFunction,
): PlaylistOfflinePresentation {
  const busy = isOfflineBusy(offlineState);
  const progress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const buttonLabel = data?.is_smart
    ? t("playlist.offline.staticOnly")
    : offlineState === "ready"
      ? t("playlist.offline.available")
      : offlineState === "error"
        ? t("playlist.offline.retry")
        : offlineState === "syncing"
          ? t("playlist.offline.syncing", { progress: progress || "" })
          : busy
            ? t("playlist.offline.downloading", {
                progress: progress || "",
              })
            : t("playlist.offline.makeAvailable");
  const statusDetail = data?.is_smart
    ? t("playlist.offline.staticOnlyDetail")
    : offlineState === "ready"
      ? offlineRecord?.trackCount
        ? t("playlist.offline.tracksAvailable", {
            count: offlineRecord.trackCount,
          })
        : t("playlist.offline.available")
      : busy && progress
        ? t("playlist.offline.progressSaved", { progress })
        : offlineState === "error"
          ? offlineRecord?.readyTrackCount
            ? t("playlist.offline.partialError", {
                ready: offlineRecord.readyTrackCount,
                total: offlineRecord.trackCount,
              })
            : t("playlist.offline.failed")
          : null;

  return { busy, progress, buttonLabel, statusDetail };
}

export function buildPlaylistMetaItems(data: PlaylistData, t: TFunction) {
  return [
    t("common.trackCountLabel", { count: data.track_count }),
    data.total_duration > 0 ? formatTotalDuration(data.total_duration) : null,
  ];
}
