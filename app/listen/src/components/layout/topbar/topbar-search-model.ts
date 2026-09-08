import { type Track } from "@/contexts/PlayerContext";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface RemoteAvailability {
  catalog: boolean;
  stream: boolean;
  import: boolean;
  stale?: boolean;
  local?: boolean;
  remote?: boolean;
  healthy?: boolean;
}

export interface SearchResult {
  artists: SearchArtistResult[];
  albums: SearchAlbumResult[];
  tracks: SearchTrackResult[];
}

export interface SearchArtistResult {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_artist_uid?: string;
  slug?: string;
  name: string;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: RemoteAvailability;
  album_count?: number;
  has_photo?: boolean;
}

export interface SearchAlbumResult {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_album_uid?: string;
  slug?: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  name: string;
  year?: string | number;
  has_cover?: boolean;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: RemoteAvailability;
}

export interface SearchTrackResult {
  id?: number;
  entity_uid?: string;
  global_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  slug?: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_entity_uid?: string;
  global_album_uid?: string;
  album_slug?: string;
  path?: string;
  duration?: number;
  origin?: "local" | "remote";
  node_uid?: string;
  node_name?: string;
  remote_entity_uid?: string;
  availability?: RemoteAvailability;
}

export interface TopBarSearchItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel?: string;
  navigateTo?: string;
  imageUrl?: string;
  trackData?: Track;
  origin?: "local" | "remote";
  nodeName?: string;
}

export interface TopBarSearchRecentEntry {
  label: string;
  type?: TopBarSearchItem["type"];
  navigateTo?: string;
  origin?: "local" | "remote";
}

export const TOP_BAR_SEARCH_RECENTS_STORAGE_KEY = "listen-search-recents:v1";
const MAX_RECENTS = 5;

function isTopBarSearchRecentEntry(
  value: unknown,
): value is TopBarSearchRecentEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "label" in value &&
    typeof (value as Record<string, unknown>).label === "string"
  );
}

function dedupeRecentEntries(
  entries: TopBarSearchRecentEntry[],
): TopBarSearchRecentEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.type ?? "unknown"}:${
      entry.navigateTo ?? entry.label
    }:${entry.origin ?? "local"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getTopBarSearchRecents(): TopBarSearchRecentEntry[] {
  try {
    const raw = localStorage.getItem(TOP_BAR_SEARCH_RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry: unknown) => {
      if (isTopBarSearchRecentEntry(entry)) return [entry];
      if (typeof entry === "string") {
        return [{ label: entry, type: undefined, navigateTo: undefined }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

export function addTopBarSearchRecent(recent: TopBarSearchRecentEntry): void {
  const recents = getTopBarSearchRecents().filter(
    (recentItem) =>
      !(
        recentItem.type === recent.type &&
        (recentItem.navigateTo ?? recentItem.label) ===
          (recent.navigateTo ?? recent.label)
      ),
  );

  recents.unshift(recent);
  const deduped = dedupeRecentEntries(recents);
  localStorage.setItem(
    TOP_BAR_SEARCH_RECENTS_STORAGE_KEY,
    JSON.stringify(deduped.slice(0, MAX_RECENTS)),
  );
}

function artistGlobalUid(artist: SearchArtistResult): string | null {
  return artist.global_artist_uid ?? artist.global_uid ?? null;
}

function albumGlobalUid(album: SearchAlbumResult): string | null {
  return album.global_album_uid ?? album.global_uid ?? null;
}

function trackGlobalUid(track: SearchTrackResult): string | null {
  return (
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid ?? null
  );
}

function trackGlobalAlbumUid(track: SearchTrackResult): string | null {
  return track.global_album_uid ?? track.album_entity_uid ?? null;
}

function resultOrigin(
  item: SearchArtistResult | SearchAlbumResult | SearchTrackResult,
): "local" | "remote" {
  if (item.origin === "remote") return "remote";
  if (item.availability?.remote && !item.availability.local) return "remote";
  return "local";
}

function resultNodeName(
  item: SearchArtistResult | SearchAlbumResult | SearchTrackResult,
): string | undefined {
  return item.node_name || undefined;
}

export function flattenTopBarSearchResults(
  data: SearchResult,
): TopBarSearchItem[] {
  const items: TopBarSearchItem[] = [];

  for (const artist of data.artists) {
    const globalUid = artistGlobalUid(artist);
    if (globalUid) {
      items.push({
        type: "artist",
        label: artist.name,
        navigateTo: artistPagePath({
          artistId: artist.id,
          artistEntityUid: artist.entity_uid,
          globalArtistUid: globalUid,
          artistSlug: artist.slug,
          artistName: artist.name,
        }),
        imageUrl: artist.has_photo
          ? artistPhotoApiUrl({ globalArtistUid: globalUid }, { size: 128 })
          : undefined,
        origin: resultOrigin(artist),
        nodeName: resultNodeName(artist),
      });
    } else {
      items.push({
        type: "artist",
        label: artist.name,
        navigateTo: artistPagePath({
          artistId: artist.id,
          artistSlug: artist.slug,
          artistName: artist.name,
        }),
        imageUrl: artistPhotoApiUrl(
          {
            artistId: artist.id,
            artistEntityUid: artist.entity_uid,
            artistSlug: artist.slug,
            artistName: artist.name,
          },
          { size: 128 },
        ),
        origin: resultOrigin(artist),
        nodeName: resultNodeName(artist),
      });
    }
  }

  for (const album of data.albums) {
    const globalUid = albumGlobalUid(album);
    if (globalUid) {
      items.push({
        type: "album",
        label: album.name,
        sublabel: album.artist,
        navigateTo: albumPagePath({
          albumId: album.id,
          albumEntityUid: album.entity_uid,
          globalAlbumUid: globalUid,
          albumSlug: album.slug,
          artistSlug: album.artist_slug,
          artistName: album.artist,
          albumName: album.name,
        }),
        imageUrl: album.has_cover
          ? albumCoverApiUrl({ globalAlbumUid: globalUid }, { size: 128 })
          : undefined,
        origin: resultOrigin(album),
        nodeName: resultNodeName(album),
      });
    } else {
      items.push({
        type: "album",
        label: album.name,
        sublabel: album.artist,
        navigateTo: albumPagePath({
          albumId: album.id,
          albumSlug: album.slug,
          artistName: album.artist,
          albumName: album.name,
        }),
        imageUrl: albumCoverApiUrl(
          {
            albumId: album.id,
            albumEntityUid: album.entity_uid,
            artistEntityUid: album.artist_entity_uid,
            albumSlug: album.slug,
            artistName: album.artist,
            albumName: album.name,
          },
          { size: 128 },
        ),
        origin: resultOrigin(album),
        nodeName: resultNodeName(album),
      });
    }
  }

  for (const track of data.tracks) {
    const globalUid = trackGlobalUid(track);
    if (globalUid) {
      const imageUrl = track.album
        ? albumCoverApiUrl(
            { globalAlbumUid: trackGlobalAlbumUid(track) },
            { size: 128 },
          )
        : undefined;
      items.push({
        type: "track",
        label: track.title,
        sublabel: `${track.artist} - ${track.album}`,
        imageUrl,
        trackData: toPlayableTrack(
          {
            ...track,
            globalTrackUid: globalUid,
          },
          { cover: imageUrl },
        ),
        origin: resultOrigin(track),
        nodeName: resultNodeName(track),
      });
    } else {
      items.push({
        type: "track",
        label: track.title,
        sublabel: `${track.artist} - ${track.album}`,
        imageUrl: track.album
          ? albumCoverApiUrl(
              {
                albumId: track.album_id,
                albumEntityUid: track.album_entity_uid,
                artistEntityUid: track.artist_entity_uid,
                albumSlug: track.album_slug,
                artistName: track.artist,
                albumName: track.album,
              },
              { size: 128 },
            )
          : undefined,
        trackData: toPlayableTrack(track),
        origin: resultOrigin(track),
        nodeName: resultNodeName(track),
      });
    }
  }

  return items;
}
