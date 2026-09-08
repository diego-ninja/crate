import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "@crate/ui/icons";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { toast } from "sonner";

import {
  type DecadeArtists,
  type SystemPlaylist,
  loadSystemPlaylistTracks,
} from "./explore-model";
import { GenreDetailContent } from "./GenreDetailSections";
import { useGenreDetailActions } from "./use-genre-detail-actions";
import { useGenreDetailModel } from "./use-genre-detail-model";

export function GenreDetailView({
  slug,
}: {
  slug: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);
  const model = useGenreDetailModel(slug);
  const actions = useGenreDetailActions({
    data: model.data,
    heroCoverUrl: model.heroCoverUrl,
    nextShow: model.nextShow,
  });

  if (model.loading) {
    return <CrateLoader label={t("genre.loading")} />;
  }
  if (!model.data) {
    return <p className="text-sm text-text-muted">{t("genre.notFound")}</p>;
  }

  return (
    <GenreDetailContent
      actionBar={{
        albumCount: model.albumCount,
        artistCount: model.artistCount,
        data: model.data,
        genreMenu: actions.genreMenu,
        genreMenuActions: actions.genreMenuActions,
        heroCoverUrl: model.heroCoverUrl,
        isDesktop: model.isDesktop,
        nextShow: model.nextShow,
        onOpenGenreRadar: actions.openGenreRadar,
        onPlayGenreRadio: () => void actions.handlePlayGenreRadio(),
        onShareGenre: actions.shareGenre,
        startingRadio: actions.startingRadio,
      }}
      artistCount={model.artistCount}
      artists={model.visibleArtists}
      albumCount={model.albumCount}
      albums={model.visibleAlbums}
      data={model.data}
      description={model.description}
      expandedShowId={expandedShowId}
      heroCoverUrl={model.heroCoverUrl}
      onCoverError={() => {
        if (model.heroCoverIndex + 1 < model.heroCoverCandidates.length) {
          model.setHeroCoverIndex((index) => index + 1);
        } else {
          model.setHeroCoverIndex(model.heroCoverCandidates.length);
        }
      }}
      onOpenRelated={(genre) =>
        navigate(
          `/explore?genre=${encodeURIComponent(genre.page_slug || genre.slug)}`,
        )
      }
      onToggleShow={(key) =>
        setExpandedShowId(expandedShowId === key ? null : key)
      }
      relatedGenres={model.visibleRelatedGenres}
      trackCount={model.trackCount}
    />
  );
}

export function DecadeDetailView({
  decade,
  onBack,
}: {
  decade: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data, loading } = useApi<DecadeArtists>(
    `/api/catalog/artists?decade=${encodeURIComponent(decade)}&per_page=50`,
  );

  if (loading) return <CrateLoader label={t("explore.decade.loading")} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-text-primary/50 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold">{decade}</h1>
          <p className="text-sm text-text-muted">
            {t("common.artistCountLabel", { count: data?.total ?? 0 })}
          </p>
        </div>
      </div>

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
          {data.items.map((artist) => (
            <ArtistCard
              key={artist.id ?? artist.global_artist_uid ?? artist.name}
              name={artist.name}
              artistId={artist.id}
              artistEntityUid={artist.entity_uid ?? undefined}
              globalArtistUid={
                artist.global_artist_uid ?? artist.global_uid ?? undefined
              }
              artistSlug={artist.slug}
              subtitle={t("common.albumCountLabel", { count: artist.albums })}
              compact
              layout="grid"
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t("explore.decade.empty")}</p>
      )}
    </div>
  );
}

export function PlaylistCategoryView({
  category,
  onBack,
}: {
  category: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { data, loading, refetch } = useApi<SystemPlaylist[]>(
    `/api/curation/playlists/category/${encodeURIComponent(category)}`,
  );

  async function handlePlayPlaylist(playlistId: number, playlistName: string) {
    try {
      const playlist = await loadSystemPlaylistTracks(playlistId);
      if (playlist.tracks.length > 0) {
        playAll(playlist.tracks, 0, { ...playlist.source, name: playlistName });
      }
    } catch {
      toast.error(t("playlist.toasts.playFailed"));
    }
  }

  async function handleToggleFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(
        `/api/curation/playlists/${playlistId}/follow`,
        isFollowed ? "DELETE" : "POST",
      );
      toast.success(
        isFollowed
          ? t("actions.playlist.toasts.removedFromLibrary")
          : t("actions.playlist.toasts.addedToLibrary"),
      );
      refetch();
    } catch {
      toast.error(t("playlist.toasts.updateFailed"));
    }
  }

  if (loading) {
    return <CrateLoader label={t("explore.playlistCategory.loading")} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="rounded-lg p-2 text-text-primary/50 transition-colors hover:bg-text-primary/5 hover:text-text-primary"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold capitalize">{category}</h1>
          <p className="text-sm text-text-muted">
            {t("common.playlistCountLabel", { count: data?.length ?? 0 })}
          </p>
        </div>
      </div>

      {data && data.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {data.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={playlist.is_smart}
              description={playlist.description}
              tracks={playlist.artwork_tracks}
              coverDataUrl={playlist.cover_data_url}
              meta={[
                playlist.category || null,
                t("common.trackCountLabel", { count: playlist.track_count }),
                playlist.follower_count > 0
                  ? t("common.followerCountLabel", {
                      count: playlist.follower_count,
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              systemPlaylist
              crateManaged
              isFollowed={playlist.is_followed}
              layout="grid"
              href={`/curation/playlist/${playlist.id}`}
              onPlay={() => handlePlayPlaylist(playlist.id, playlist.name)}
              onToggleFollow={() =>
                handleToggleFollow(playlist.id, playlist.is_followed)
              }
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-quiet px-4 py-6 text-sm text-text-muted">
          {t("explore.playlistCategory.empty")}
        </div>
      )}
    </div>
  );
}
