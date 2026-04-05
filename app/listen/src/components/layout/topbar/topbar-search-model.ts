import { type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

export interface SearchResult {
  artists: { name: string }[];
  albums: { artist: string; name: string }[];
  tracks: {
    id?: number;
    title: string;
    artist: string;
    album: string;
    path?: string;
    navidrome_id?: string;
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
      navigateTo: `/artist/${encPath(artist.name)}`,
      imageUrl: `/api/artist/${encPath(artist.name)}/photo`,
    });
  }

  for (const album of data.albums) {
    items.push({
      type: "album",
      label: album.name,
      sublabel: album.artist,
      navigateTo: `/album/${encPath(album.artist)}/${encPath(album.name)}`,
      imageUrl: `/api/cover/${encPath(album.artist)}/${encPath(album.name)}`,
    });
  }

  for (const track of data.tracks) {
    items.push({
      type: "track",
      label: track.title,
      sublabel: `${track.artist} - ${track.album}`,
      imageUrl: track.album
        ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
        : undefined,
      trackData: {
        id: track.path || String(track.id),
        path: track.path,
        title: track.title,
        artist: track.artist,
        album: track.album,
        navidromeId: track.navidrome_id,
      },
    });
  }

  return items;
}
