import type { TFunction } from "i18next";

import type { Track } from "@/contexts/PlayerContext";
import { isOfflineBusy } from "@/lib/offline";
import type { OfflineItemRecord, OfflineItemState } from "@/lib/offline";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { formatTotalDuration } from "@/lib/utils";
import type {
  CuratedPlayerTracks,
  CuratedPlaylistData,
} from "@/pages/curated-playlist-types";

export interface CuratedOfflinePresentation {
  busy: boolean;
  progress: string | null;
  buttonLabel: string;
  statusDetail: string | null;
}

export function buildCuratedPlayerTracks(
  data: CuratedPlaylistData | undefined,
): CuratedPlayerTracks {
  if (!data?.tracks.length) return [];
  return data.tracks.map(
    (track): Track =>
      toPlayableTrack(track, {
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
      }),
  );
}

export function buildCuratedOfflinePresentation(
  data: CuratedPlaylistData | undefined,
  offlineState: OfflineItemState,
  offlineRecord: OfflineItemRecord | null,
  t: TFunction,
): CuratedOfflinePresentation {
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const offlineButtonLabel = data?.is_smart
    ? t("playlist.offline.staticOnly")
    : offlineState === "ready"
      ? t("playlist.offline.available")
      : offlineState === "error"
        ? t("playlist.offline.retry")
        : offlineState === "syncing"
          ? t("playlist.offline.syncing", { progress: offlineProgress || "" })
          : offlineBusy
            ? t("playlist.offline.downloading", {
                progress: offlineProgress || "",
              })
            : t("playlist.offline.makeAvailable");
  const offlineStatusDetail = data?.is_smart
    ? t("playlist.offline.staticOnlyDetail")
    : offlineState === "ready"
      ? offlineRecord?.trackCount
        ? t("playlist.offline.tracksAvailable", {
            count: offlineRecord.trackCount,
          })
        : t("playlist.offline.available")
      : offlineBusy && offlineProgress
        ? t("playlist.offline.progressSaved", { progress: offlineProgress })
        : offlineState === "error"
          ? offlineRecord?.readyTrackCount
            ? t("playlist.offline.partialError", {
                ready: offlineRecord.readyTrackCount,
                total: offlineRecord.trackCount,
              })
            : t("playlist.offline.failed")
          : null;

  return {
    busy: offlineBusy,
    progress: offlineProgress,
    buttonLabel: offlineButtonLabel,
    statusDetail: offlineStatusDetail,
  };
}

export function buildCuratedPlaylistMetaItems(
  data: CuratedPlaylistData,
  t: TFunction,
) {
  return [
    t("common.trackCountLabel", { count: data.track_count }),
    data.total_duration > 0 ? formatTotalDuration(data.total_duration) : null,
    t("common.followerCountLabel", { count: data.follower_count }),
    data.category,
  ];
}
