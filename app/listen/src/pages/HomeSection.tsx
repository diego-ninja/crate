import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
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
import { fetchAlbumRadio, fetchArtistRadio, fetchHomePlaylistRadio } from "@/lib/radio";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray } from "@/lib/utils";

function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return toPlayableTrack(item, {
    cover:
      item.artist && item.album
        ? albumCoverApiUrl({
            albumId: item.album_id || undefined,
            albumEntityUid: item.album_entity_uid || undefined,
            artistEntityUid: item.artist_entity_uid || undefined,
            albumSlug: item.album_slug || undefined,
            artistName: item.artist,
            albumName: item.album,
          }) || undefined
        : undefined,
  });
}

function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

export function HomeSection() {
  const navigate = useNavigate();
  const { playAll } = usePlayerActions();
  const { sectionId } = useParams<{ sectionId: HomeSectionId }>();
  const { data, loading } = useApi<HomeSectionDetailPayload>(
    sectionId ? `/api/me/home/sections/${sectionId}?limit=42` : null,
  );

  const recommendedTracks = useMemo(
    () =>
      data?.id === "recommended-tracks"
        ? data.items.map((item): TrackRowData => toTrackRowData(item))
        : [],
    [data],
  );

  async function loadHomePlaylist(playlistId: string) {
    return api<HomeGeneratedPlaylistDetail>(`/api/me/home/playlists/${encodeURIComponent(playlistId)}`);
  }

  async function playHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info("This playlist is still warming up");
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error("Failed to load playlist");
    }
  }

  async function shuffleHomePlaylist(item: HomeGeneratedPlaylistSummary) {
    try {
      const playlist = await loadHomePlaylist(item.id);
      const queue = (playlist.tracks || []).map(toPlayerTrack);
      if (!queue.length) {
        toast.info("This playlist is still warming up");
        return;
      }
      playAll(shuffleArray(queue), 0, {
        type: "playlist",
        name: playlist.name || item.name,
        id: playlist.id,
      });
    } catch {
      toast.error("Failed to load playlist");
    }
  }

  async function startHomePlaylistRadio(item: HomeGeneratedPlaylistSummary) {
    try {
      const radio = await fetchHomePlaylistRadio({
        playlistId: item.id,
        playlistName: item.name,
      });
      if (!radio.tracks.length) {
        toast.info("Playlist radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start playlist radio");
    }
  }

  async function playRadioStation(station: HomeRadioStation) {
    try {
      if (station.type === "artist" && station.artist_id != null) {
        const radio = await fetchArtistRadio(station.artist_id, station.artist_name, 50);
        if (!radio.tracks.length) {
          toast.info("Artist radio is not available yet");
          return;
        }
        playAll(radio.tracks, 0, radio.source);
        return;
      }
      if (station.type === "album" && station.album_id != null) {
        const radio = await fetchAlbumRadio({
          albumId: station.album_id,
          artistName: station.artist_name,
          albumName: station.album_name || station.title,
        });
        if (!radio.tracks.length) {
          toast.info("Album radio is not available yet");
          return;
        }
        playAll(radio.tracks, 0, radio.source);
      }
    } catch {
      toast.error("Failed to start radio");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Section not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back
      </button>

      <div>
        <h1 className="text-3xl font-bold text-foreground">{data.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{data.subtitle}</p>
      </div>

      {data.id === "recently-played" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item, index) => (
            <RecentEntityRow
              key={`${item.type}-${index}`}
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

      {data.id === "suggested-albums" ? (
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          {data.items.map((album) => (
            <AlbumCard
              key={`${album.album_id ?? `${album.artist_name}-${album.album_name}`}`}
              artist={album.artist_name}
              album={album.album_name}
              albumId={album.album_id}
              albumEntityUid={album.album_entity_uid}
              artistEntityUid={album.artist_entity_uid}
              albumSlug={album.album_slug}
              year={album.year}
              layout="grid"
            />
          ))}
        </div>
      ) : null}

      {data.id === "recommended-tracks" ? (
        <div className="space-y-2">
          {recommendedTracks.map((track, index) => (
            <TrackRow
              key={track.id ?? `${track.path}-${index}`}
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
              key={`${station.type}-${station.artist_id ?? station.album_id ?? station.title}`}
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
              key={artist.artist_id ?? artist.artist_name}
              name={artist.artist_name}
              artistId={artist.artist_id}
              artistEntityUid={artist.artist_entity_uid}
              artistSlug={artist.artist_slug}
              subtitle={`${artist.play_count} plays`}
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
              onOpenPlaylist={(playlist) => navigate(homePlaylistPath(playlist.id))}
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
