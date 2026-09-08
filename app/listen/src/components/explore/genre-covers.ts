import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  artistBackgroundApiUrl,
  artistPhotoApiUrl,
  genreCoverApiUrl,
} from "@/lib/library-routes";

import type { GenreDetail } from "./explore-model";

type RelatedGenre = NonNullable<GenreDetail["related_genres"]>[number];

export function buildRelatedGenreImageCandidates(genre: RelatedGenre) {
  const topArtistPhoto = genre.top_artist_global_uid
    ? artistPhotoApiUrl(
        {
          artistId: genre.top_artist_id,
          globalArtistUid: genre.top_artist_global_uid,
        },
        { size: 640, format: "webp" },
      )
    : resolveMaybeApiAssetUrl(genre.top_artist_photo_url);
  const candidates = [
    resolveGenreCoverCandidate(genre.cover_url, 640),
    topArtistPhoto ? null : relatedGenreCoverUrl(genre.page_slug),
    topArtistPhoto ? null : relatedGenreCoverUrl(genre.slug),
    topArtistPhoto,
  ].filter((url): url is string => Boolean(url));

  return [...new Set(candidates)];
}

function relatedGenreCoverUrl(slug?: string | null) {
  const normalizedSlug = slug?.trim();
  if (!normalizedSlug) return null;
  return genreCoverApiUrl(normalizedSlug, { size: 640, format: "webp" });
}

function genreCoverSlugFromUrl(url?: string | null) {
  const match = url?.match(/\/api\/genres\/([^/?]+)\/cover(?:\?|$)/);
  if (!match) return null;
  const encodedSlug = match[1];
  if (!encodedSlug) return null;
  try {
    return decodeURIComponent(encodedSlug);
  } catch {
    return encodedSlug;
  }
}

function resolveGenreCoverCandidate(
  url: string | null | undefined,
  size: number,
) {
  if (!url) return null;
  const genreSlug = genreCoverSlugFromUrl(url);
  if (genreSlug) {
    return genreCoverApiUrl(genreSlug, { size, format: "webp" });
  }
  if (/\/api\/catalog\/artists\/[^/?]+\/background(?:\?|$)/.test(url)) {
    return null;
  }
  return resolveMaybeApiAssetUrl(url);
}

function upscaleGenreCoverUrl(
  url?: string | null,
  fallbackSlug?: string | null,
) {
  const genreSlug = genreCoverSlugFromUrl(url) || (!url ? fallbackSlug : null);
  if (genreSlug) {
    return genreCoverApiUrl(genreSlug, { size: 1280, format: "webp" });
  }
  const resolved = resolveMaybeApiAssetUrl(url || null);
  if (!resolved) return null;
  return resolved.replace(
    /([?&]size=)640\b/,
    (_, prefix: string) => `${prefix}1280`,
  );
}

export function buildGenreHeroCoverCandidates(
  url?: string | null,
  fallbackSlug?: string | null,
  artists?: GenreDetail["artists"],
) {
  const generatedArtistCover = Boolean(
    url &&
      /\/api\/catalog\/artists\/[^/?]+\/(?:background|photo)(?:\?|$)/.test(url),
  );
  const primary = generatedArtistCover ? null : upscaleGenreCoverUrl(url);
  const fallbackArtistBackground =
    buildGenreHeroArtistBackgroundFallback(artists);
  const fallback =
    !generatedArtistCover && url && fallbackSlug
      ? upscaleGenreCoverUrl(undefined, fallbackSlug)
      : null;

  return [primary, fallback, fallbackArtistBackground].filter(
    (candidate, index, candidates): candidate is string =>
      Boolean(candidate) && candidates.indexOf(candidate) === index,
  );
}

function buildGenreHeroArtistBackgroundFallback(
  artists?: GenreDetail["artists"],
) {
  const topArtist = artists?.[0];
  if (
    !topArtist?.has_photo ||
    (!topArtist.artist_id && !topArtist.global_artist_uid)
  ) {
    return null;
  }

  return artistBackgroundApiUrl(
    {
      artistId: topArtist.artist_id,
      globalArtistUid: topArtist.global_artist_uid,
      artistEntityUid: topArtist.artist_entity_uid,
    },
    { size: 1280, format: "webp" },
  );
}
