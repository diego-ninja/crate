import type { Track } from "@/contexts/PlayerContext";
import {
  buildArtistAlbumCover,
  buildArtistPhotoUrl,
  buildArtistPlayerTrack,
  buildArtistShowItems,
  sortArtistAlbumsByYear,
  type ArtistData,
  type ArtistInfo,
  type ArtistPageData,
  type ArtistPageEnrichment,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import {
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

export interface ArtistPageViewModel {
  data: ArtistData;
  info: ArtistInfo | undefined;
  topTracks: ArtistTopTrack[];
  showsData: ArtistPageData["shows"] | undefined;
  enrichment: ArtistPageEnrichment | undefined;
  coverFallback: string | undefined;
  playerTracks: Track[];
  similarArtists: ArtistInfo["similar"];
  appearsOn: ArtistPageData["appears_on"];
  currentGlobalArtistUid: string | null;
  artistShowItems: ReturnType<typeof buildArtistShowItems>;
  albumsSorted: ArtistData["albums"];
  previewTopTracks: ArtistTopTrack[];
  visibleShowItems: ReturnType<typeof buildArtistShowItems>;
  artistHotNow: boolean;
  imageVersion: string | undefined;
  hasArtistPhoto: boolean;
  photoUrl: string;
  canonicalPhotoUrl: string;
  backgroundUrl: string;
  tags: string[];
  canonicalPath: string;
}

export function buildArtistRequestPath(
  routeGlobalArtistUid: string | null,
  routeArtistSlug: string | undefined,
) {
  if (routeGlobalArtistUid) {
    return `/api/catalog/artists/${encodeURIComponent(
      routeGlobalArtistUid,
    )}/page`;
  }
  if (routeArtistSlug) {
    return `/api/artist-slugs/${encodeURIComponent(
      routeArtistSlug,
    )}/page?top_tracks_count=50`;
  }
  return null;
}

export function buildArtistCanonicalPath(
  data: ArtistData,
  routeGlobalArtistUid: string | null,
) {
  return artistPagePath({
    artistId: data.id,
    artistEntityUid: data.entity_uid,
    globalArtistUid: routeGlobalArtistUid,
    artistSlug: data.slug,
    artistName: data.name,
  });
}

export function buildArtistPageViewModel(
  pageData: ArtistPageData,
  routeGlobalArtistUid: string | null,
): ArtistPageViewModel {
  const data = pageData.artist;
  const info = pageData.info;
  const topTracks = pageData.top_tracks ?? [];
  const showsData = pageData.shows;
  const enrichment = pageData.enrichment;
  const firstAlbum = data.albums[0];
  const coverFallback = firstAlbum
    ? buildArtistAlbumCover(
        data.name,
        firstAlbum.name,
        typeof firstAlbum.id === "number" ? firstAlbum.id : null,
        firstAlbum.slug,
        firstAlbum.global_album_uid ?? firstAlbum.global_uid,
      )
    : undefined;
  const playerTracks = topTracks.map((track) =>
    buildArtistPlayerTrack(track, data.name, coverFallback),
  );
  const currentGlobalArtistUid =
    routeGlobalArtistUid ?? data.global_artist_uid ?? data.global_uid ?? null;
  const artistShowItems = buildArtistShowItems(showsData?.events ?? []);
  const visibleShowItems = [...artistShowItems]
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 5);
  const imageVersion = data.updated_at ?? undefined;
  const hasArtistPhoto = data.has_photo !== false;
  const photoUrl = hasArtistPhoto
    ? buildArtistPhotoUrl(data.name, data.id, data.slug, imageVersion)
    : "";

  return {
    data,
    info,
    topTracks,
    showsData,
    enrichment,
    coverFallback,
    playerTracks,
    similarArtists: info?.similar ?? [],
    appearsOn: pageData.appears_on ?? [],
    currentGlobalArtistUid,
    artistShowItems,
    albumsSorted: sortArtistAlbumsByYear(data.albums),
    previewTopTracks: topTracks.slice(0, 5),
    visibleShowItems,
    artistHotNow: pageData.artist_hot_rank != null,
    imageVersion,
    hasArtistPhoto,
    photoUrl,
    canonicalPhotoUrl: hasArtistPhoto
      ? artistPhotoApiUrl(
          {
            artistId: data.id,
            globalArtistUid: currentGlobalArtistUid,
            artistSlug: data.slug,
            artistName: data.name,
          },
          { size: 512, version: imageVersion },
        )
      : "",
    backgroundUrl: artistBackgroundApiUrl(
      {
        artistId: data.id,
        globalArtistUid: currentGlobalArtistUid,
        artistSlug: data.slug,
        artistName: data.name,
      },
      { size: 1280, version: imageVersion },
    ),
    tags: data.genres.length > 0 ? data.genres : info?.tags ?? [],
    canonicalPath: buildArtistCanonicalPath(data, routeGlobalArtistUid),
  };
}
