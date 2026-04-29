import { type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, albumPagePath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";

export interface SearchResult {
  artists: { id?: number; entity_uid?: string; slug?: string; name: string }[];
  albums: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    name: string;
  }[];
  tracks: {
    id?: number;
    entity_uid?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_entity_uid?: string;
    artist_slug?: string;
    album: string;
    album_id?: number;
    album_entity_uid?: string;
    album_slug?: string;
    path?: string;
  }[];
}

export interface TopBarSearchItem {
  type: "artist" | "album" | "track";
  label: string;
  sublabel?: string;
  navigateTo?: string;
  imageUrl?: string;
  trackData?: Track;
}

const RECENTS_KEY = "listen-search-recents";
const MAX_RECENTS = 5;

export function getTopBarSearchRecents(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addTopBarSearchRecent(term: string) {
  const recents = getTopBarSearchRecents().filter((recent) => recent !== term);
  recents.unshift(term);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
}

export function flattenTopBarSearchResults(data: SearchResult): TopBarSearchItem[] {
  const items: TopBarSearchItem[] = [];

  for (const artist of data.artists) {
    items.push({
      type: "artist",
      label: artist.name,
      navigateTo: artistPagePath({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name }),
      imageUrl: artistPhotoApiUrl({
        artistId: artist.id,
        artistEntityUid: artist.entity_uid,
        artistSlug: artist.slug,
        artistName: artist.name,
      }, { size: 128 }),
    });
  }

  for (const album of data.albums) {
    items.push({
      type: "album",
      label: album.name,
      sublabel: album.artist,
      navigateTo: albumPagePath({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }),
      imageUrl: albumCoverApiUrl({
        albumId: album.id,
        albumEntityUid: album.entity_uid,
        artistEntityUid: album.artist_entity_uid,
        albumSlug: album.slug,
        artistName: album.artist,
        albumName: album.name,
      }, { size: 128 }),
    });
  }

  for (const track of data.tracks) {
    items.push({
      type: "track",
      label: track.title,
      sublabel: `${track.artist} - ${track.album}`,
      imageUrl: track.album ? albumCoverApiUrl({
        albumId: track.album_id,
        albumEntityUid: track.album_entity_uid,
        artistEntityUid: track.artist_entity_uid,
        albumSlug: track.album_slug,
        artistName: track.artist,
        albumName: track.album,
      }, { size: 128 }) : undefined,
      trackData: toPlayableTrack(track),
    });
  }

  return items;
}
