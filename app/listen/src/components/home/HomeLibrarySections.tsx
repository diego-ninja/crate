import { useTranslation } from "react-i18next";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";

import type {
  CuratedPlaylist,
  GlobalArtist,
  LibraryAddition,
} from "./home-model";
import {
  FeaturedPlaylistCard,
  SectionHeader,
  SectionLoading,
  SectionRail,
} from "./HomeSections";

export function FromCrateSection({
  playlists,
  loading,
  onOpenPlaylist,
  onPlayPlaylist,
  onToggleFollow,
}: {
  playlists?: CuratedPlaylist[];
  loading: boolean;
  onOpenPlaylist: (playlistId: number) => void;
  onPlayPlaylist: (playlistId: number, playlistName: string) => void;
  onToggleFollow: (playlistId: number, isFollowed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.library.fromCrate.title")}
        subtitle={t("home.library.fromCrate.subtitle")}
      />
      {loading ? (
        <SectionLoading />
      ) : playlists && playlists.length > 0 ? (
        <SectionRail>
          {playlists.map((playlist) => (
            <FeaturedPlaylistCard
              key={playlist.id}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={playlist.is_smart}
              description={playlist.description}
              coverDataUrl={playlist.cover_data_url}
              tracks={playlist.artwork_tracks}
              meta={`${t("common.trackCountLabel", {
                count: playlist.track_count,
              })}${playlist.category ? ` · ${playlist.category}` : ""}`}
              href={`/curation/playlist/${playlist.id}`}
              isFollowed={playlist.is_followed}
              onPlay={() => onPlayPlaylist(playlist.id, playlist.name)}
              onToggleFollow={() =>
                onToggleFollow(playlist.id, playlist.is_followed)
              }
              onClick={() => onOpenPlaylist(playlist.id)}
            />
          ))}
        </SectionRail>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("home.library.fromCrate.empty")}
        </div>
      )}
    </section>
  );
}

export function HomeLibrarySection({
  additions,
  loading,
  onOpenLibrary,
  onPlayPlaylist,
  onToggleSystemPlaylistFollow,
  onOpenPlaylist,
  onOpenSystemPlaylist,
}: {
  additions: LibraryAddition[];
  loading: boolean;
  onOpenLibrary: () => void;
  onPlayPlaylist: (
    playlistId: number,
    isSystem: boolean,
    playlistName: string,
  ) => void;
  onToggleSystemPlaylistFollow: (playlistId: number) => void;
  onOpenPlaylist: (playlistId: number) => void;
  onOpenSystemPlaylist: (playlistId: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.library.inYourLibrary.title")}
        subtitle={t("home.library.inYourLibrary.subtitle")}
        actionLabel={t("home.library.inYourLibrary.action")}
        onAction={onOpenLibrary}
      />

      {loading ? (
        <SectionLoading />
      ) : additions.length > 0 ? (
        <SectionRail>
          {additions.map((item) => {
            if (
              (item.type === "playlist" || item.type === "system_playlist") &&
              item.playlist_id &&
              item.playlist_name
            ) {
              const isSystem = item.type === "system_playlist";
              const playlistMeta = isSystem
                ? `${t("common.trackCountLabel", {
                    count: item.playlist_track_count || 0,
                  })}${
                    item.playlist_follower_count != null
                      ? ` · ${t("common.followerCountLabel", {
                          count: item.playlist_follower_count,
                        })}`
                      : ""
                  }`
                : t("common.trackCountLabel", {
                    count: item.playlist_track_count || 0,
                  });
              return (
                <PlaylistCard
                  key={`${item.type}-${item.playlist_id}-${item.added_at}`}
                  playlistId={item.playlist_id}
                  name={item.playlist_name}
                  isSmart={item.playlist_badge?.toLowerCase() === "smart"}
                  description={item.playlist_description}
                  tracks={item.playlist_tracks}
                  coverDataUrl={item.playlist_cover_data_url}
                  meta={playlistMeta}
                  systemPlaylist={isSystem}
                  crateManaged={isSystem}
                  isFollowed={isSystem}
                  badge={isSystem ? undefined : item.playlist_badge}
                  href={
                    isSystem
                      ? `/curation/playlist/${item.playlist_id}`
                      : `/playlist/${item.playlist_id}`
                  }
                  onPlay={() =>
                    onPlayPlaylist(
                      item.playlist_id!,
                      isSystem,
                      item.playlist_name!,
                    )
                  }
                  onToggleFollow={
                    isSystem
                      ? () => onToggleSystemPlaylistFollow(item.playlist_id!)
                      : undefined
                  }
                  onClick={() =>
                    isSystem
                      ? onOpenSystemPlaylist(item.playlist_id!)
                      : onOpenPlaylist(item.playlist_id!)
                  }
                />
              );
            }

            if (item.album_id && item.album_name && item.album_artist) {
              return (
                <AlbumCard
                  key={`album-${item.album_id}-${item.added_at}`}
                  artist={item.album_artist}
                  album={item.album_name}
                  albumId={item.album_id}
                  albumEntityUid={item.album_entity_uid}
                  artistEntityUid={item.album_artist_entity_uid}
                  albumSlug={item.album_slug}
                  year={item.album_year}
                />
              );
            }

            return null;
          })}
        </SectionRail>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("home.library.inYourLibrary.empty")}
        </div>
      )}
    </section>
  );
}

export function JustLandedSection({
  artists,
  loading,
  onOpenExplore,
}: {
  artists?: GlobalArtist[];
  loading: boolean;
  onOpenExplore: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.library.justLanded.title")}
        subtitle={t("home.library.justLanded.subtitle")}
        actionLabel={t("nav.explore")}
        onAction={onOpenExplore}
      />
      {loading ? (
        <SectionLoading />
      ) : artists?.length ? (
        <>
          <div className="xl:hidden">
            <SectionRail fit="square-card">
              {artists.slice(0, 7).map((artist) => {
                const albumCount = artist.albums ?? artist.album_count ?? 0;
                const trackCount = artist.tracks ?? artist.track_count ?? 0;
                return (
                  <ArtistCard
                    key={`just-landed-${
                      artist.global_artist_uid ?? artist.id ?? artist.name
                    }`}
                    name={artist.name}
                    artistId={artist.id}
                    artistEntityUid={artist.entity_uid}
                    globalArtistUid={artist.global_artist_uid}
                    artistSlug={artist.slug}
                    photo={artist.photo_url ?? undefined}
                    hasPhoto={artist.has_photo}
                    subtitle={`${t("common.albumCountLabel", {
                      count: albumCount,
                    })} · ${t("common.trackCountLabel", {
                      count: trackCount,
                    })}`}
                    layout="grid"
                    fillGrid
                  />
                );
              })}
            </SectionRail>
          </div>
          <div className="hidden xl:grid xl:grid-cols-7 xl:gap-4">
            {artists.slice(0, 7).map((artist) => {
              const albumCount = artist.albums ?? artist.album_count ?? 0;
              const trackCount = artist.tracks ?? artist.track_count ?? 0;
              return (
                <ArtistCard
                  key={`just-landed-grid-${
                    artist.global_artist_uid ?? artist.id ?? artist.name
                  }`}
                  name={artist.name}
                  artistId={artist.id}
                  artistEntityUid={artist.entity_uid}
                  globalArtistUid={artist.global_artist_uid}
                  artistSlug={artist.slug}
                  photo={artist.photo_url ?? undefined}
                  hasPhoto={artist.has_photo}
                  subtitle={`${t("common.albumCountLabel", {
                    count: albumCount,
                  })} · ${t("common.trackCountLabel", {
                    count: trackCount,
                  })}`}
                  layout="grid"
                  fillGrid
                />
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("home.library.justLanded.empty")}
        </div>
      )}
    </section>
  );
}
