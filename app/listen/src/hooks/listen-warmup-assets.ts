import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistSummary,
} from "@/components/home/home-model";
import {
  albumCoverApiUrl,
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

function addAsset(
  target: string[],
  url: string | null | undefined,
  limit = 24,
): void {
  if (!url || target.includes(url) || target.length >= limit) return;
  target.push(url);
}

function playlistArtworkAssets(item: HomeGeneratedPlaylistSummary): string[] {
  const urls: string[] = [];
  for (const track of item.artwork_tracks || []) {
    addAsset(
      urls,
      albumCoverApiUrl(
        {
          albumId: track.album_id,
          albumEntityUid: track.album_entity_uid,
          artistEntityUid: track.artist_entity_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        },
        { size: 192 },
      ),
      4,
    );
  }
  return urls;
}

export function collectHomeWarmupAssets(
  discovery: HomeDiscoveryPayload,
): string[] {
  const urls: string[] = [];
  const heroes = Array.isArray(discovery.hero)
    ? discovery.hero
    : discovery.hero
      ? [discovery.hero]
      : [];

  for (const hero of heroes.slice(0, 3)) {
    addAsset(
      urls,
      artistBackgroundApiUrl(
        {
          artistId: hero.id,
          artistSlug: hero.slug,
          artistName: hero.name,
        },
        { size: 1280 },
      ),
    );
  }

  for (const item of (discovery.recently_played || []).slice(0, 9)) {
    if (item.type === "artist") {
      addAsset(
        urls,
        artistPhotoApiUrl(
          {
            artistId: item.artist_id,
            artistEntityUid: item.artist_entity_uid,
            artistSlug: item.artist_slug,
            artistName: item.artist_name,
          },
          { size: 192 },
        ),
      );
    } else if (item.type === "album") {
      addAsset(
        urls,
        albumCoverApiUrl(
          {
            albumId: item.album_id,
            albumEntityUid: item.album_entity_uid,
            artistEntityUid: item.artist_entity_uid,
            albumSlug: item.album_slug,
            artistName: item.artist_name,
            albumName: item.album_name,
          },
          { size: 192 },
        ),
      );
    }
  }

  for (const album of (discovery.suggested_albums || []).slice(0, 8)) {
    addAsset(
      urls,
      albumCoverApiUrl(
        {
          albumId: album.album_id,
          albumEntityUid: album.album_entity_uid,
          artistEntityUid: album.artist_entity_uid,
          albumSlug: album.album_slug,
          artistName: album.artist_name,
          albumName: album.album_name,
        },
        { size: 256 },
      ),
    );
  }

  for (const station of (discovery.radio_stations || []).slice(0, 6)) {
    if (station.type === "album") {
      addAsset(
        urls,
        albumCoverApiUrl(
          {
            albumId: station.album_id,
            albumEntityUid: station.album_entity_uid,
            artistEntityUid: station.artist_entity_uid,
            albumSlug: station.album_slug,
            artistName: station.artist_name,
            albumName: station.album_name,
          },
          { size: 256 },
        ),
      );
    } else {
      addAsset(
        urls,
        artistPhotoApiUrl(
          {
            artistId: station.artist_id,
            artistEntityUid: station.artist_entity_uid,
            artistSlug: station.artist_slug,
            artistName: station.artist_name,
          },
          { size: 256 },
        ),
      );
    }
  }

  for (const artist of (discovery.favorite_artists || []).slice(0, 8)) {
    addAsset(
      urls,
      artistPhotoApiUrl(
        {
          artistId: artist.artist_id,
          globalArtistUid: artist.global_artist_uid,
          artistEntityUid: artist.artist_entity_uid,
          artistSlug: artist.artist_slug,
          artistName: artist.artist_name,
        },
        { size: 192 },
      ),
    );
  }

  for (const playlist of [
    ...(discovery.custom_mixes || []).slice(0, 4),
    ...(discovery.essentials || []).slice(0, 4),
  ]) {
    for (const url of playlistArtworkAssets(playlist)) {
      addAsset(urls, url);
    }
  }

  return urls;
}

export function collectHomeWarmupPlaylistUrls(
  discovery: HomeDiscoveryPayload,
): string[] {
  const ids = new Set<string>();
  for (const playlist of [
    ...(discovery.custom_mixes || []).slice(0, 4),
    ...(discovery.essentials || []).slice(0, 4),
  ]) {
    if (playlist.id) ids.add(playlist.id);
  }
  return Array.from(ids).map(
    (id) => `/api/me/home/playlists/${encodeURIComponent(id)}`,
  );
}
