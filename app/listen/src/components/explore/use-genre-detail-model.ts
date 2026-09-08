import { useCallback, useMemo, useState, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { useApi } from "@/hooks/use-api";

import type { GenreDetail } from "./explore-model";
import { buildGenreHeroCoverCandidates } from "./genre-covers";

interface GenreDetailSummary {
  description: string;
  artistCount: number;
  albumCount: number;
  trackCount: number;
  visibleArtists: GenreDetail["artists"];
  visibleAlbums: GenreDetail["albums"];
  visibleRelatedGenres: NonNullable<GenreDetail["related_genres"]>;
}

function buildGenreDetailSummary(
  data: GenreDetail | null | undefined,
  primaryArtists: GenreDetail["artists"],
  primaryAlbums: GenreDetail["albums"],
  isDesktop: boolean,
  t: ReturnType<typeof useTranslation>["t"],
): GenreDetailSummary {
  if (!data) {
    return {
      description: t("genre.defaultDescription"),
      artistCount: 0,
      albumCount: 0,
      trackCount: 0,
      visibleArtists: primaryArtists,
      visibleAlbums: primaryAlbums,
      visibleRelatedGenres: [],
    };
  }

  const description =
    data.description ||
    data.canonical_description ||
    data.external_description ||
    t("genre.defaultDescription");
  const hasArtistMemberships = data.artists.some((artist) => artist.membership);
  const hasAlbumMemberships = data.albums.some((album) => album.membership);
  const artistCount = hasArtistMemberships
    ? primaryArtists.length
    : data.artist_count ?? primaryArtists.length;
  const albumCount = hasAlbumMemberships
    ? primaryAlbums.length
    : data.album_count ?? primaryAlbums.length;
  const directAlbumTrackCount = primaryAlbums.reduce(
    (total, album) => total + (album.track_count || 0),
    0,
  );
  const trackCount = hasAlbumMemberships
    ? directAlbumTrackCount
    : data.track_count ?? directAlbumTrackCount;

  return {
    description,
    artistCount,
    albumCount,
    trackCount,
    visibleArtists: isDesktop ? primaryArtists : primaryArtists.slice(0, 12),
    visibleAlbums: isDesktop ? primaryAlbums : primaryAlbums.slice(0, 12),
    visibleRelatedGenres: (data.related_genres ?? []).slice(
      0,
      isDesktop ? 12 : 6,
    ),
  };
}

export function useGenreDetailModel(slug: string) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { data, loading } = useApi<GenreDetail>(
    `/api/catalog/genres/${slug}`,
    "GET",
    undefined,
    { revalidateIfCached: "never" },
  );
  const primaryArtists = useMemo(
    () =>
      (data?.artists ?? []).filter(
        (artist) => artist.membership !== "inherited",
      ),
    [data?.artists],
  );
  const primaryAlbums = useMemo(
    () =>
      (data?.albums ?? []).filter((album) => album.membership !== "inherited"),
    [data?.albums],
  );
  const nextShow = data?.shows?.[0] ?? null;
  const fallbackGenreSlug = data?.canonical_slug || data?.slug;
  const heroCoverCandidates = useMemo(
    () =>
      buildGenreHeroCoverCandidates(
        data?.cover_url,
        fallbackGenreSlug,
        primaryArtists,
      ),
    [data?.cover_url, fallbackGenreSlug, primaryArtists],
  );
  const heroCoverFingerprint = heroCoverCandidates.join("|");
  const [heroCoverState, setHeroCoverState] = useState({
    fingerprint: heroCoverFingerprint,
    index: 0,
  });
  const heroCoverIndex =
    heroCoverState.fingerprint === heroCoverFingerprint
      ? heroCoverState.index
      : 0;
  const setHeroCoverIndex = useCallback(
    (next: SetStateAction<number>) => {
      setHeroCoverState((previous) => {
        const currentIndex =
          previous.fingerprint === heroCoverFingerprint ? previous.index : 0;
        return {
          fingerprint: heroCoverFingerprint,
          index: typeof next === "function" ? next(currentIndex) : next,
        };
      });
    },
    [heroCoverFingerprint],
  );

  const summary = useMemo(
    () =>
      buildGenreDetailSummary(
        data,
        primaryArtists,
        primaryAlbums,
        isDesktop,
        t,
      ),
    [data, isDesktop, primaryAlbums, primaryArtists, t],
  );

  return {
    data,
    loading,
    isDesktop,
    primaryArtists,
    primaryAlbums,
    nextShow,
    heroCoverCandidates,
    heroCoverIndex,
    heroCoverUrl: heroCoverCandidates[heroCoverIndex] ?? null,
    ...summary,
    setHeroCoverIndex,
  };
}
