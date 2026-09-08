import type { TFunction } from "i18next";

import type { TrackRowData } from "@/components/cards/TrackRow";
import { buildAlbumQualityBadges } from "@/pages/album-model";
import type { AlbumData, AlbumTrack } from "@/pages/album-types";
import {
  isOfflineBusy,
  type OfflineItemRecord,
  type OfflineItemState,
} from "@/lib/offline";
import {
  albumCoverApiUrl,
  albumSharePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  contributionSourceLabel,
  contributorDisplayName,
  contributorProfilePath,
} from "@/lib/contributions";
import { publicShareUrl } from "@/lib/share-url";
import { toTrackRowData } from "@/lib/track-row-data";

export function buildAlbumPresentationState({
  albumId,
  data,
  displayName,
  getAlbumRecord,
  getAlbumState,
  globalAlbumUid,
  isSaved,
  offlineSupported,
  artistName,
  t,
}: {
  albumId: number;
  artistName: string;
  data: AlbumData | null;
  displayName: string;
  getAlbumRecord: (albumId?: number | null) => OfflineItemRecord | null;
  getAlbumState: (albumId?: number | null) => OfflineItemState;
  globalAlbumUid: string | null;
  isSaved: (albumId: number, globalAlbumUid: string | null) => boolean;
  offlineSupported: boolean;
  t: TFunction;
}) {
  const isPreRelease = Boolean(data?.is_pre_release);
  const coverUrl = data
    ? resolveMaybeApiAssetUrl(data.cover_url) ||
      albumCoverApiUrl(
        {
          albumId: data.id,
          globalAlbumUid: data.global_album_uid ?? data.global_uid,
          albumEntityUid: data.entity_uid,
          artistEntityUid: data.artist_entity_uid,
          albumSlug: data.slug,
          artistName: data.artist,
          albumName: data.name,
        },
        { size: 768 },
      )
    : "";
  const artistPhotoUrl = data
    ? artistPhotoApiUrl(
        {
          artistId: data.artist_id,
          artistEntityUid: data.artist_entity_uid,
          globalArtistUid: data.global_artist_uid,
          artistSlug: data.artist_slug,
          artistName: data.artist,
        },
        { size: 512 },
      )
    : "";
  const remoteOnly =
    data?.availability?.remote === true && data.availability.local !== true;
  const canPersistAlbum = !isPreRelease && albumId > 0;
  const canSaveAlbum =
    !isPreRelease && (albumId > 0 || Boolean(globalAlbumUid));
  const primaryContributor = data?.contributors?.[0] ?? null;
  const primaryContributorName = contributorDisplayName(primaryContributor);
  const primaryContributorPath = contributorProfilePath(primaryContributor);
  const primaryContributorSource = contributionSourceLabel(
    primaryContributor?.source,
  );
  const saved = canSaveAlbum ? isSaved(albumId, globalAlbumUid) : false;
  const offlineState = getAlbumState(canPersistAlbum ? albumId : undefined);
  const offlineRecord = canPersistAlbum ? getAlbumRecord(albumId) : null;
  const offlineCopy = buildAlbumOfflineCopy({
    canPersistAlbum,
    offlineRecord,
    offlineState,
    t,
  });

  return {
    artistPhotoUrl,
    canPersistAlbum,
    canSaveAlbum,
    coverUrl,
    genre:
      data && data.genres.length > 0
        ? data.genres.join(", ")
        : data?.album_tags?.genre,
    isPreRelease,
    offlineButtonLabel: offlineCopy.offlineButtonLabel,
    offlineBusy: offlineCopy.offlineBusy,
    offlineRecord,
    offlineState,
    offlineStatusDetail: offlineCopy.offlineStatusDetail,
    offlineSupported,
    primaryContributorName,
    primaryContributorPath,
    primaryContributorSource,
    qualityBadges: buildAlbumQualityBadges(data?.tracks ?? []),
    remoteOnly,
    saved,
    shareUrl: publicShareUrl(
      albumSharePath({
        albumId,
        globalAlbumUid,
        albumEntityUid: data?.entity_uid,
        albumSlug: data?.slug,
        artistEntityUid: data?.artist_entity_uid,
        artistSlug: data?.artist_slug,
        artistName,
        albumName: data?.name ?? displayName,
      }),
    ),
    visibleContributor:
      primaryContributorName && primaryContributor ? primaryContributor : null,
    year: data?.album_tags?.year?.slice(0, 4),
  };
}

export function buildAlbumOfflineCopy({
  canPersistAlbum,
  offlineRecord,
  offlineState,
  t,
}: {
  canPersistAlbum: boolean;
  offlineRecord: OfflineItemRecord | null;
  offlineState: OfflineItemState;
  t: TFunction;
}) {
  const offlineBusy = isOfflineBusy(offlineState);
  const offlineProgress = offlineRecord?.trackCount
    ? `${Math.min(
        offlineRecord.readyTrackCount || 0,
        offlineRecord.trackCount,
      )}/${offlineRecord.trackCount}`
    : null;
  const offlineButtonLabel =
    offlineState === "ready"
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
  const offlineStatusDetail = canPersistAlbum
    ? offlineState === "ready"
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
            : t("album.offline.failed")
          : null
    : null;

  return {
    offlineButtonLabel,
    offlineBusy,
    offlineProgress,
    offlineStatusDetail,
  };
}

export function buildAlbumTrackRowData({
  albumId,
  data,
  displayName,
  fallbackIndex,
  globalAlbumUid,
  globalArtistUid,
  track,
}: {
  albumId: number;
  data: AlbumData | null;
  displayName: string;
  fallbackIndex: number;
  globalAlbumUid: string | null;
  globalArtistUid: string | null;
  track: AlbumTrack;
}): TrackRowData {
  const globalTrackUid =
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
  return toTrackRowData({
    id: track.id,
    globalTrackUid,
    global_artist_uid: globalArtistUid,
    global_album_uid: globalAlbumUid,
    entity_uid: track.entity_uid,
    title: track.tags.title || track.filename,
    artist: data?.artist ?? "",
    artist_id: data?.artist_id,
    artist_entity_uid: data?.artist_entity_uid,
    artist_slug: data?.artist_slug,
    album: displayName,
    album_id: albumId > 0 ? albumId : undefined,
    album_entity_uid: data?.entity_uid,
    album_slug: data?.slug,
    duration: track.length_sec,
    path: track.path,
    track_number: parseInt(track.tags.tracknumber) || fallbackIndex + 1,
    format: track.format,
    bitrate: track.bitrate,
    sample_rate: track.sample_rate,
    bit_depth: track.bit_depth,
    bpm: track.bpm,
    audio_key: track.audio_key,
    audio_scale: track.audio_scale,
    energy: track.energy,
    danceability: track.danceability,
    valence: track.valence,
    bliss_vector: track.bliss_vector,
    library_track_id:
      track.is_available === false || typeof track.id !== "number"
        ? undefined
        : track.id,
    disabled: track.is_available === false,
  });
}
