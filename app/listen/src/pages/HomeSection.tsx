import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft } from "@crate/ui/icons";
import { toast } from "sonner";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CrateLoader } from "@/components/ui/CrateLoader";
import {
  CoreTracksPlaylistCard,
  CustomMixCard,
  RadioStationCard,
  RecentEntityRow,
  openRecentItemPath,
} from "@/components/home/HomeDiscoverySections";
import type {
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
  HomeRadioStation,
  HomeRecommendedTrack,
  HomeSectionDetailPayload,
  HomeSectionId,
} from "@/components/home/home-model";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import {
  fetchAlbumRadio,
  fetchArtistRadio,
  fetchHomePlaylistRadio,
} from "@/lib/radio";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray } from "@/lib/utils";

function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return toPlayableTrack(item, {
    cover:
      item.artist && item.album
        ? albumCoverApiUrl(
            {
              albumId: item.album_id || undefined,
              albumEntityUid: item.album_entity_uid || undefined,
              artistEntityUid: item.artist_entity_uid || undefined,
              albumSlug: item.album_slug || undefined,
              artistName: item.artist,
              albumName: item.album,
            },
            { size: 512 },
          ) || undefined
        : undefined,
  });
}

function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

async function loadHomePlaylist(playlistId: string) {
  return api<HomeGeneratedPlaylistDetail>(
    `/api/me/home/playlists/${encodeURIComponent(playlistId)}`,
  );
}

export function HomeSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { sectionId } = useParams<{ sectionId: HomeSectionId }>();
  const { data, loading } = useApi<HomeSectionDetailPayload>(
    sectionId ? `/api/me/home/sections/${sectionId}?limit=42` : null,
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );

  const recommendedTracks = useMemo(
    () =>
      data?.id === "recommended-tracks"
        ? data.items.map((item): TrackRowData => toTrackRowData(item))
        : [],
    [data],
  );

  async function playHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info(t("home.playlists.warming"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error(t("home.playlists.loadFailed"));
    }
  }

  async function shuffleHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info(t("home.playlists.warming"));
        return;
      }
      playAll(shuffleArray(queue), 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error(t("home.playlists.loadFailed"));
    }
  }

  async function startHomePlaylistRadio(item: HomeGeneratedPlaylistSummary) {
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: item.id,
        playlistName: item.name,
      });
      if (!radio.tracks.length) {
        toast.info(t("actions.playlist.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("actions.playlist.toasts.radioFailed"));
    }
  }

  async function playRadioStation(station: HomeRadioStation) {
    try {
      const artistSeed =
        station.seed_value ??
        station.global_artist_uid ??
        (station.artist_id != null ? String(station.artist_id) : null);
      const albumSeed =
        station.seed_value ??
        station.global_album_uid ??
        (station.album_id != null ? String(station.album_id) : null);
      if (station.type === "artist" && artistSeed && station.artist_name) {
        const radio = await fetchArtistRadio(
          artistSeed,
          station.artist_name,
          50,
        );
        if (!radio.tracks.length) {
          toast.info(t("actions.artist.toasts.radioUnavailable"));
          return;
        }
        playAll(radio.tracks, 0, radio.source);
        return;
      }
      if (station.type === "album" && albumSeed && station.artist_name) {
        const radio = await fetchAlbumRadio({
          albumId: albumSeed,
          artistName: station.artist_name,
          albumName: station.album_name || station.title,
        });
        if (!radio.tracks.length) {
          toast.info(t("actions.album.toasts.radioUnavailable"));
          return;
        }
        playAll(radio.tracks, 0, radio.source);
      }
    } catch {
      toast.error(t("home.radio.toasts.startFailed"));
    }
  }

  if (loading) {
    return <CrateLoader label={t("home.section.loading")} />;
  }

  if (!data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-text-muted">{t("home.section.notFound")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={16} />
        {t("common.back")}
      </button>

      <div>
        <h1 className="text-3xl font-bold text-text-primary">{data.title}</h1>
        <p className="mt-2 text-sm text-text-muted">{data.subtitle}</p>
      </div>

      {!data.items.length ? (
        <div className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] px-5 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            {t("home.section.empty.title")}
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            {t("home.section.empty.description")}
          </p>
        </div>
      ) : null}

      {data.id === "recently-played" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <RecentEntityRow
              key={[
                item.type,
                openRecentItemPath(item),
                item.played_at ?? "",
              ].join(":")}
              item={item}
              onClick={() => navigate(openRecentItemPath(item))}
            />
          ))}
        </div>
      ) : null}

      {data.id === "custom-mixes" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {data.items.map((item) => (
            <CustomMixCard
              key={item.id}
              item={item}
              onOpenMix={(mix) => navigate(homePlaylistPath(mix.id))}
              onPlayMix={playHomePlaylist}
              onShuffleMix={shuffleHomePlaylist}
              onStartRadio={startHomePlaylistRadio}
              layout="grid"
            />
          ))}
        </div>
      ) : null}

      {data.id === "suggested-albums" || data.id === "upcoming-albums" ? (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          {data.items.map((album) => (
            <AlbumCard
              key={`${
                album.global_album_uid ??
                album.album_id ??
                `${album.artist_name}-${album.album_name}`
              }`}
              artist={album.artist_name}
              album={album.album_name}
              albumId={album.album_id}
              albumEntityUid={album.album_entity_uid}
              globalAlbumUid={album.global_album_uid}
              artistEntityUid={album.artist_entity_uid}
              albumSlug={album.album_slug}
              year={album.year}
              cover={album.cover_url ?? undefined}
              isPreRelease={album.is_pre_release}
              releaseDate={album.release_date}
              layout="grid"
            />
          ))}
        </div>
      ) : null}

      {data.id === "recommended-tracks" ? (
        <div className="space-y-2">
          {recommendedTracks.map((track) => (
            <TrackRow
              key={
                track.id ??
                track.global_track_uid ??
                track.entity_uid ??
                track.path ??
                [track.artist, track.album, track.title].join(":")
              }
              track={track}
              showArtist
              showAlbum
              showCoverThumb
              queueTracks={recommendedTracks}
            />
          ))}
        </div>
      ) : null}

      {data.id === "radio-stations" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {data.items.map((station) => (
            <RadioStationCard
              key={`${station.type}-${
                station.seed_value ??
                station.global_artist_uid ??
                station.global_album_uid ??
                station.artist_id ??
                station.album_id ??
                station.title
              }`}
              station={station}
              onPlay={() => playRadioStation(station)}
              layout="grid"
            />
          ))}
        </div>
      ) : null}

      {data.id === "favorite-artists" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {data.items.map((artist) => (
            <ArtistCard
              key={
                artist.global_artist_uid ??
                artist.artist_id ??
                artist.artist_name
              }
              name={artist.artist_name}
              artistId={artist.artist_id}
              globalArtistUid={artist.global_artist_uid}
              artistEntityUid={artist.artist_entity_uid}
              artistSlug={artist.artist_slug}
              subtitle={t("common.playCount", { count: artist.play_count })}
              layout="grid"
              fillGrid
            />
          ))}
        </div>
      ) : null}

      {data.id === "core-tracks" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {data.items.map((item) => (
            <CoreTracksPlaylistCard
              key={item.id}
              item={item}
              onOpenPlaylist={(playlist) =>
                navigate(homePlaylistPath(playlist.id))
              }
              onPlayPlaylist={playHomePlaylist}
              onShufflePlaylist={shuffleHomePlaylist}
              onStartRadio={startHomePlaylistRadio}
              layout="grid"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
