import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { fetchArtistTopTracks } from "@/components/actions/shared";
import {
  CustomMixesSection,
  EssentialsSection,
  FavoriteArtistsSection,
  HomeTasteHero,
  openRecentItemPath,
  RadioStationsSection,
  RecentlyPlayedSection,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import {
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import {
  HomeReplaySection,
} from "@/components/home/HomePlaybackSections";
import {
  HomeShowPrepSection,
  HomeUpcomingSection,
} from "@/components/home/HomeUpcomingSections";
import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeRadioStation,
  HomeRecommendedTrack,
  HomeSectionId,
  HomeUpcomingInsight,
  ReplayMix,
} from "@/components/home/home-model";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { api, apiSseUrl } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { fetchAlbumRadio, fetchArtistRadio, fetchHomePlaylistRadio } from "@/lib/radio";
import { albumCoverApiUrl, artistPagePath } from "@/lib/library-routes";
import { shuffleArray } from "@/lib/utils";

function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return {
    id: item.track_storage_id || item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
    storageId: item.track_storage_id || undefined,
    title: item.title,
    artist: item.artist,
    artistId: item.artist_id || undefined,
    artistSlug: item.artist_slug || undefined,
    album: item.album || undefined,
    albumId: item.album_id || undefined,
    albumSlug: item.album_slug || undefined,
    albumCover: item.artist && item.album
      ? albumCoverApiUrl({
          albumId: item.album_id,
          albumSlug: item.album_slug,
          artistName: item.artist,
          albumName: item.album,
        }) || undefined
      : undefined,
    path: item.track_path || undefined,
    libraryTrackId: item.track_id || undefined,
    format: item.format || undefined,
    bitrate: item.bitrate,
    sampleRate: item.sample_rate,
    bitDepth: item.bit_depth,
  };
}

function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

function homeSectionPath(sectionId: HomeSectionId): string {
  return `/home/section/${sectionId}`;
}

export function Home() {
  const navigate = useNavigate();
  const { play, playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();

  const { data: discovery, refetch: refetchDiscovery } =
    useApi<HomeDiscoveryPayload>("/api/me/home/discovery", "GET", undefined, { reactive: false });
  const [liveDiscovery, setLiveDiscovery] = useState<HomeDiscoveryPayload | null>(null);

  useEffect(() => {
    if (discovery) {
      setLiveDiscovery(discovery);
    }
  }, [discovery]);

  useEffect(() => {
    const source = new EventSource(apiSseUrl("/api/me/home/discovery-stream"));
    source.onmessage = (event) => {
      try {
        setLiveDiscovery(JSON.parse(event.data) as HomeDiscoveryPayload);
      } catch {
        // Ignore malformed snapshots and keep the last good payload.
      }
    };
    return () => source.close();
  }, []);

  const currentDiscovery = liveDiscovery ?? discovery;
  // Normalize: backend now returns array, old cache may still return single object
  const heroRaw = currentDiscovery?.hero ?? null;
  const heroes: HomeHeroArtist[] = Array.isArray(heroRaw) ? heroRaw : heroRaw ? [heroRaw] : [];
  const recentGlobalArtists = currentDiscovery?.recent_global_artists || [];
  const upcoming = currentDiscovery?.upcoming;
  const replay = currentDiscovery?.replay as ReplayMix | undefined;
  const globalArtistsLoading = !currentDiscovery;

  const onRefresh = useCallback(async () => {
    refetchDiscovery();
  }, [refetchDiscovery]);

  const { handlers: pullHandlers, pullDistance, refreshing } = usePullToRefresh(onRefresh);

  const replayPreview = (replay?.items || []).slice(0, 4);
  const upcomingPreview = (upcoming?.items || [])
    .filter((item) => item.is_upcoming)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);
  const homeInsights = (upcoming?.insights || []).slice(0, 2);

  const recommendedTracks = useMemo(
    () =>
      (currentDiscovery?.recommended_tracks || []).map((item) => ({
        id: item.track_id ?? item.track_storage_id ?? item.track_path ?? item.title,
        storage_id: item.track_storage_id ?? undefined,
        title: item.title,
        artist: item.artist,
        artist_id: item.artist_id ?? undefined,
        artist_slug: item.artist_slug ?? undefined,
        album: item.album ?? undefined,
        album_id: item.album_id ?? undefined,
        album_slug: item.album_slug ?? undefined,
        path: item.track_path ?? undefined,
        duration: item.duration ?? undefined,
        library_track_id: item.track_id ?? undefined,
      })),
    [currentDiscovery?.recommended_tracks],
  );

  function openHomeSection(sectionId: HomeSectionId) {
    navigate(homeSectionPath(sectionId));
  }

  async function playHeroArtist(artist: HomeHeroArtist) {
    try {
      const queue = await fetchArtistTopTracks({
        artistId: artist.id,
        artistSlug: artist.slug,
        name: artist.name,
      });
      if (!queue.length) {
        toast.info("No top tracks available yet");
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: `${artist.name} Top Tracks`,
        radio: { seedType: "artist", seedId: artist.id },
      });
    } catch {
      toast.error("Failed to load artist tracks");
    }
  }

  async function toggleHeroFollow(artist: HomeHeroArtist) {
    try {
      await toggleArtistFollow(artist.id);
      // Refetch to replace followed artist with a new one
      refetchDiscovery();
      toast.success(
        isFollowing(artist.id)
          ? `Unfollowed ${artist.name}`
          : `Following ${artist.name}`,
      );
    } catch {
      toast.error("Failed to update follow status");
    }
  }

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

  async function acknowledgeInsight(insight: HomeUpcomingInsight) {
    try {
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success("Saved for later");
      navigate("/upcoming");
    } catch {
      toast.error("Failed to save reminder");
    }
  }

  async function playInsightSetlist(insight: HomeUpcomingInsight) {
    try {
      if (!insight.artist_id) return;
      const queue = await fetchPlayableSetlist({ artistId: insight.artist_id, artistName: insight.artist });
      if (!queue.length) {
        toast.info("No probable setlist tracks matched your library");
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${insight.artist} Probable Setlist` });
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    }
  }

  function playReplayMix() {
    if (!replay?.items?.length) return;
    const queue: Track[] = replay.items.map((item) => ({
      id: item.track_storage_id || item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
      storageId: item.track_storage_id || undefined,
      title: item.title,
      artist: item.artist,
      album: item.album,
      path: item.track_path || undefined,
      libraryTrackId: item.track_id || undefined,
      albumCover: item.artist && item.album
        ? albumCoverApiUrl({ albumId: item.album_id, albumSlug: item.album_slug, artistName: item.artist, albumName: item.album })
        : undefined,
      artistId: item.artist_id || undefined,
      artistSlug: item.artist_slug || undefined,
      albumId: item.album_id || undefined,
      albumSlug: item.album_slug || undefined,
    }));
    playAll(queue, 0, { type: "playlist", name: replay.title });
  }

  return (
    <div className="space-y-10" {...pullHandlers}>
      <PullIndicator distance={pullDistance} refreshing={refreshing} />

      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{getHomeGreeting()}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{getHomeDateString()}</p>
        </div>

        <HomeTasteHero
          heroes={heroes}
          isFollowing={isFollowing}
          onOpenArtist={(artist) => {
            navigate(
              artistPagePath({
                artistId: artist.id,
                artistSlug: artist.slug,
                artistName: artist.name,
              }),
            );
          }}
          onPlay={(artist) => void playHeroArtist(artist)}
          onToggleFollow={(artist) => void toggleHeroFollow(artist)}
          onInfo={(artist) => {
            navigate(
              artistPagePath({
                artistId: artist.id,
                artistSlug: artist.slug,
                artistName: artist.name,
              }),
            );
          }}
        />
      </div>

      <RecentlyPlayedSection
        items={currentDiscovery?.recently_played || []}
        onOpenItem={(item) => navigate(openRecentItemPath(item))}
        onViewAll={openHomeSection}
      />

      <CustomMixesSection
        mixes={currentDiscovery?.custom_mixes || []}
        onOpenMix={(mix) => navigate(homePlaylistPath(mix.id))}
        onPlayMix={(mix) => void playHomePlaylist(mix)}
        onShuffleMix={(mix) => void shuffleHomePlaylist(mix)}
        onStartRadio={(mix) => void startHomePlaylistRadio(mix)}
        onViewAll={openHomeSection}
      />

      <SuggestedAlbumsSection albums={currentDiscovery?.suggested_albums || []} onViewAll={openHomeSection} />

      <RecommendedTracksSection tracks={recommendedTracks} onViewAll={openHomeSection} />

      <RadioStationsSection
        stations={currentDiscovery?.radio_stations || []}
        onPlayStation={(station) => void playRadioStation(station)}
        onViewAll={openHomeSection}
      />

      <FavoriteArtistsSection artists={currentDiscovery?.favorite_artists || []} onViewAll={openHomeSection} />

      <EssentialsSection
        items={currentDiscovery?.essentials || []}
        onOpenPlaylist={(item) => navigate(homePlaylistPath(item.id))}
        onPlayPlaylist={(item) => void playHomePlaylist(item)}
        onShufflePlaylist={(item) => void shuffleHomePlaylist(item)}
        onStartRadio={(item) => void startHomePlaylistRadio(item)}
        onViewAll={openHomeSection}
      />

      <HomeUpcomingSection
        previewItems={upcomingPreview}
        summary={upcoming?.summary}
        onOpenUpcoming={() => navigate("/upcoming")}
      />

      <HomeShowPrepSection
        insights={homeInsights}
        onOpenUpcoming={() => navigate("/upcoming")}
        onPlaySetlist={(insight) => void playInsightSetlist(insight)}
        onSaveReminder={(insight) => void acknowledgeInsight(insight)}
      />

      <HomeReplaySection
        replay={replay || undefined}
        replayPreview={replayPreview}
        onOpenStats={() => navigate("/stats")}
        onPlayReplay={playReplayMix}
        onPlayTrack={(item) => play(toPlayerTrack(item), { type: "track", name: item.title })}
      />

        <JustLandedSection
          artists={recentGlobalArtists}
          loading={globalArtistsLoading}
          onOpenExplore={() => navigate("/explore")}
        />
    </div>
  );
}
