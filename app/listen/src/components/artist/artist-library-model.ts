import { albumCoverApiUrl, responsiveImageSrcSet } from "@/lib/library-routes";

import {
  buildArtistAlbumCover,
  type ArtistAlbum,
} from "@/components/artist/artist-model";

export const ARTIST_ALBUM_IMAGE_WIDTHS = [160, 256, 320, 480] as const;

export type ArtistReleaseCategory = NonNullable<
  ArtistAlbum["release_category"]
>;

export const RELEASE_GROUPS: {
  category: ArtistReleaseCategory;
  labelKey: string;
}[] = [
  { category: "album", labelKey: "artist.sections.albums" },
  { category: "ep_single", labelKey: "artist.sections.epsAndSingles" },
  { category: "compilation", labelKey: "artist.sections.compilations" },
  { category: "live", labelKey: "artist.sections.liveAlbums" },
  { category: "other", labelKey: "artist.sections.otherReleases" },
];

export function releaseCategory(album: ArtistAlbum): ArtistReleaseCategory {
  if (album.release_category) return album.release_category;

  const primaryType = album.release_type?.trim().toLocaleLowerCase() ?? "";
  const secondaryTypes = new Set(
    (album.release_secondary_types ?? []).map((value) =>
      value.trim().toLocaleLowerCase(),
    ),
  );

  if (secondaryTypes.has("live")) return "live";
  if (secondaryTypes.has("compilation")) return "compilation";
  if (
    [
      "remix",
      "soundtrack",
      "spokenword",
      "audiobook",
      "interview",
      "audio drama",
      "dj-mix",
      "mixtape/street",
    ].some((value) => secondaryTypes.has(value))
  ) {
    return "other";
  }
  if (primaryType === "ep" || primaryType === "single") return "ep_single";
  if (primaryType === "album") return "album";
  if (primaryType) return "other";

  const title = album.display_name || album.name;
  if (/\blive\b/i.test(title)) return "live";
  if (
    /\b(?:best of|greatest hits|anthology|compilation|complete albums?|collected|collection)\b/i.test(
      title,
    )
  ) {
    return "compilation";
  }
  if (/\b(?:ep|single)\b/i.test(title) || album.tracks === 1) {
    return "ep_single";
  }
  return "album";
}

export interface ArtistAlbumPresentation {
  globalAlbumUid: string | null;
  localAlbumId?: number;
  cover?: string;
  coverSrcSet?: string;
  albumName: string;
  coverRouteInput: Parameters<typeof albumCoverApiUrl>[0];
}

export function buildArtistAlbumPresentation(
  album: ArtistAlbum,
  artistName: string,
  artistSlug?: string,
): ArtistAlbumPresentation {
  const globalAlbumUid =
    album.global_album_uid ??
    album.global_uid ??
    (typeof album.id === "string" ? album.id : null);
  const localAlbumId =
    typeof album.id === "number" && !album.is_pre_release
      ? album.id
      : undefined;
  const cover =
    album.cover_url ||
    buildArtistAlbumCover(
      artistName,
      album.name,
      localAlbumId,
      album.slug,
      globalAlbumUid,
      album.entity_uid,
    );
  const coverRouteInput = {
    albumId: localAlbumId,
    albumEntityUid: album.entity_uid ?? undefined,
    globalAlbumUid: album.entity_uid ? undefined : globalAlbumUid,
    albumSlug: album.slug,
    artistSlug,
    artistName,
    albumName: album.display_name || album.name,
  };
  const coverSrcSet = album.cover_url
    ? undefined
    : responsiveImageSrcSet(ARTIST_ALBUM_IMAGE_WIDTHS, (size) =>
        albumCoverApiUrl(coverRouteInput, { size }),
      );

  return {
    globalAlbumUid,
    localAlbumId,
    cover,
    coverSrcSet,
    albumName: album.display_name || album.name,
    coverRouteInput,
  };
}
