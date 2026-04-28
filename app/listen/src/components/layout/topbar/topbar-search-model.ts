import { type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl, albumPagePath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";

export interface SearchResult {
  artists: { id?: number; slug?: string; name: string }[];
  albums: { id?: number; slug?: string; artist: string; artist_id?: number; artist_slug?: string; name: string }[];
  tracks: {
    id?: number;
    storage_id?: string;
    slug?: string;
    title: string;
    artist: string;
    artist_id?: number;
    artist_slug?: string;
    album: string;
    album_id?: number;
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
      imageUrl: artistPhotoApiUrl({ artistId: artist.id, artistSlug: artist.slug, artistName: artist.name }, { size: 128 }),
    });
  }

  for (const album of data.albums) {
    items.push({
      type: "album",
      label: album.name,
      sublabel: album.artist,
      navigateTo: albumPagePath({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }),
      imageUrl: albumCoverApiUrl({ albumId: album.id, albumSlug: album.slug, artistName: album.artist, albumName: album.name }, { size: 128 }),
    });
  }

  for (const track of data.tracks) {
    items.push({
      type: "track",
      label: track.title,
      sublabel: `${track.artist} - ${track.album}`,
      imageUrl: track.album ? albumCoverApiUrl({
        albumId: track.album_id,
        albumSlug: track.album_slug,
        artistName: track.artist,
        albumName: track.album,
      }, { size: 128 }) : undefined,
      trackData: {
        id: track.storage_id || track.path || String(track.id),
        storageId: track.storage_id,
        path: track.path,
        title: track.title,
        artist: track.artist,
        artistId: track.artist_id,
        artistSlug: track.artist_slug,
        album: track.album,
        albumId: track.album_id,
        albumSlug: track.album_slug,
        libraryTrackId: typeof track.id === "number" ? track.id : undefined,
      },
    });
  }

  return items;
}
