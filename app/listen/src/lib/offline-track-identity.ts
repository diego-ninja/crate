import { apiUrl } from "@/lib/api";
import {
  trackOfflineManifestApiPath,
  trackStreamApiPath,
} from "@/lib/library-routes";

export function normalizeIdentityValue(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function legacyTrackStreamApiPath(storageId: string): string {
  return `/api/tracks/by-storage/${encodeURIComponent(storageId)}/stream`;
}

function legacyTrackOfflineManifestApiPath(storageId: string): string {
  return `/api/offline/tracks/by-storage/${encodeURIComponent(
    storageId,
  )}/manifest`;
}

export type OfflineTrackIdentityInput =
  | string
  | null
  | undefined
  | {
      entity_uid?: string | null;
      storage_id?: string | null;
      track_id?: number | null;
      path?: string | null;
      track_path?: string | null;
    }
  | {
      entityUid?: string | null;
      storageId?: string | null;
      trackId?: number | null;
      libraryTrackId?: number | null;
      path?: string | null;
      trackPath?: string | null;
    };

type OfflineTrackIdentityObject = Exclude<
  OfflineTrackIdentityInput,
  string | null | undefined
>;
type OfflineTrackSnakeIdentity = {
  entity_uid?: string | null;
  storage_id?: string | null;
  track_id?: number | null;
  path?: string | null;
  track_path?: string | null;
};
type OfflineTrackCamelIdentity = {
  entityUid?: string | null;
  storageId?: string | null;
  trackId?: number | null;
  libraryTrackId?: number | null;
  path?: string | null;
  trackPath?: string | null;
};

function hasSnakeCaseOfflineIdentity(
  track: OfflineTrackIdentityObject,
): track is OfflineTrackSnakeIdentity {
  return (
    "entity_uid" in track ||
    "storage_id" in track ||
    "track_id" in track ||
    "track_path" in track
  );
}

function readOfflineTrackEntityUid(
  track: OfflineTrackIdentityObject,
): string | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return normalizeIdentityValue(track.entity_uid);
  }
  return normalizeIdentityValue((track as OfflineTrackCamelIdentity).entityUid);
}

function readOfflineTrackStorageId(
  track: OfflineTrackIdentityObject,
): string | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return normalizeIdentityValue(track.storage_id);
  }
  return normalizeIdentityValue((track as OfflineTrackCamelIdentity).storageId);
}

function readOfflineTrackLibraryId(
  track: OfflineTrackIdentityObject,
): number | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return typeof track.track_id === "number" && Number.isFinite(track.track_id)
      ? track.track_id
      : null;
  }
  const camelTrack = track as OfflineTrackCamelIdentity;
  const id = camelTrack.libraryTrackId ?? camelTrack.trackId;
  return typeof id === "number" && Number.isFinite(id) ? id : null;
}

function readOfflineTrackPath(
  track: OfflineTrackIdentityObject,
): string | null {
  if (hasSnakeCaseOfflineIdentity(track)) {
    return (
      normalizeIdentityValue(track.track_path) ||
      normalizeIdentityValue(track.path)
    );
  }
  const camelTrack = track as OfflineTrackCamelIdentity;
  return (
    normalizeIdentityValue(camelTrack.trackPath) ||
    normalizeIdentityValue(camelTrack.path)
  );
}

export function getOfflineTrackAssetKey(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string | null {
  if (typeof track === "string") {
    return normalizeIdentityValue(storageId) || normalizeIdentityValue(track);
  }
  if (!track) {
    return normalizeIdentityValue(storageId);
  }
  return (
    readOfflineTrackEntityUid(track) ||
    readOfflineTrackStorageId(track) ||
    normalizeIdentityValue(storageId)
  );
}

export function getOfflineTrackAssetAliases(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string[] {
  const aliases = new Set<string>();
  const primary = getOfflineTrackAssetKey(track, storageId);
  if (primary) aliases.add(primary);

  if (track && typeof track === "object") {
    const entityAlias = readOfflineTrackEntityUid(track);
    const storageAlias = readOfflineTrackStorageId(track);
    if (entityAlias) aliases.add(entityAlias);
    if (storageAlias) aliases.add(storageAlias);
  } else if (typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) aliases.add(generic);
  }

  const explicitStorage = normalizeIdentityValue(storageId);
  if (explicitStorage) aliases.add(explicitStorage);
  return Array.from(aliases);
}

export function getOfflineTrackCacheUrls(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string[] {
  const urls = new Set<string>();
  const entityUid =
    track && typeof track === "object"
      ? readOfflineTrackEntityUid(track)
      : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : null);
  const path =
    track && typeof track === "object" ? readOfflineTrackPath(track) : null;

  if (entityUid) {
    urls.add(apiUrl(trackStreamApiPath({ entityUid })));
  }
  if (resolvedStorageId) {
    urls.add(apiUrl(legacyTrackStreamApiPath(resolvedStorageId)));
  }
  if (!entityUid && !resolvedStorageId && path) {
    urls.add(apiUrl(trackStreamApiPath({ path })));
  }
  if (!entityUid && !resolvedStorageId && typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) {
      urls.add(apiUrl(legacyTrackStreamApiPath(generic)));
      urls.add(apiUrl(trackStreamApiPath({ entityUid: generic })));
    }
  }
  return Array.from(urls);
}

export function getOfflineTrackManifestPaths(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string[] {
  const urls = new Set<string>();
  const entityUid =
    track && typeof track === "object"
      ? readOfflineTrackEntityUid(track)
      : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : null);
  const trackId =
    track && typeof track === "object"
      ? readOfflineTrackLibraryId(track)
      : null;
  const path =
    track && typeof track === "object" ? readOfflineTrackPath(track) : null;

  if (entityUid) {
    urls.add(trackOfflineManifestApiPath({ entityUid }));
  } else if (resolvedStorageId) {
    urls.add(legacyTrackOfflineManifestApiPath(resolvedStorageId));
  } else if (trackId != null) {
    urls.add(trackOfflineManifestApiPath({ trackId }));
  } else if (path) {
    urls.add(trackOfflineManifestApiPath({ path }));
  }
  if (!entityUid && !resolvedStorageId && typeof track === "string") {
    const generic = normalizeIdentityValue(track);
    if (generic) {
      urls.add(trackOfflineManifestApiPath({ entityUid: generic }));
      urls.add(legacyTrackOfflineManifestApiPath(generic));
    }
  }
  return Array.from(urls);
}

export function canonicalStreamPath(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string {
  const entityUid =
    track && typeof track === "object"
      ? readOfflineTrackEntityUid(track)
      : null;
  const resolvedStorageId =
    normalizeIdentityValue(storageId) ||
    (track && typeof track === "object"
      ? readOfflineTrackStorageId(track)
      : typeof track === "string"
        ? normalizeIdentityValue(track)
        : null);
  if (entityUid) return trackStreamApiPath({ entityUid });
  if (resolvedStorageId) return legacyTrackStreamApiPath(resolvedStorageId);
  throw new Error("Offline stream path requires entity_uid or storage_id");
}

export function canonicalStreamUrl(
  track: OfflineTrackIdentityInput,
  storageId?: string | null,
): string {
  return apiUrl(canonicalStreamPath(track, storageId));
}
