import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { toPlayableTrack } from "@/lib/playable-track";
import {
  getSseChannelState,
  markSseChannelClosed,
  markSseChannelError,
  markSseChannelEvent,
  markSseChannelOpen,
  onSseChannelState,
} from "@/lib/sse";
import { toTrackRowData } from "@/lib/track-row-data";
import { shuffleArray } from "@/lib/utils";

function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return toPlayableTrack(item, {
    cover:
      item.artist && item.album
        ? albumCoverApiUrl({
            albumId: item.album_id,
            albumEntityUid: item.album_entity_uid,
            artistEntityUid: item.artist_entity_uid,
            albumSlug: item.album_slug,
            artistName: item.artist,
            albumName: item.album,
          }) || undefined
        : undefined,
  });
}

function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}

function homeSectionPath(sectionId: HomeSectionId): string {
  return `/home/section/${sectionId}`;
}

function snapshotVersion(payload: HomeDiscoveryPayload | null | undefined): number {
  return Number(payload?.snapshot?.version || 0);
}

const HOME_DISCOVERY_SSE_CHANNEL = "home-discovery";
const HOME_DISCOVERY_DEGRADE_AFTER_MS = 75_000;
const HOME_DISCOVERY_DEGRADED_REFRESH_MS = 60_000;

export function Home() {
  const navigate = useNavigate();
  const { play, playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();

  const { data: discovery, refetch: refetchDiscovery } =
    useApi<HomeDiscoveryPayload>("/api/me/home/discovery", "GET", undefined, {
      reactive: false,
      revalidateIfCached: "idle",
      idleRevalidateMs: 12_000,
    });
  const [liveDiscovery, setLiveDiscovery] = useState<HomeDiscoveryPayload | null>(null);
  const refreshingLiveDiscoveryRef = useRef(false);
  const lastDegradedRefreshAtRef = useRef(0);

  const applyDiscoveryPayload = useCallback((next: HomeDiscoveryPayload | null) => {
    if (!next) return;
    startTransition(() => {
      setLiveDiscovery((current) => (
        snapshotVersion(next) >= snapshotVersion(current) ? next : current
      ));
    });
  }, []);

  useEffect(() => {
    if (discovery) {
      applyDiscoveryPayload(discovery);
    }
  }, [applyDiscoveryPayload, discovery]);

  const refreshLiveDiscovery = useCallback(async (fresh = false) => {
    if (refreshingLiveDiscoveryRef.current) return;
    if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return;
    refreshingLiveDiscoveryRef.current = true;
    try {
      const payload = await api<HomeDiscoveryPayload>(
        fresh ? "/api/me/home/discovery?fresh=1" : "/api/me/home/discovery",
      );
      applyDiscoveryPayload(payload);
    } catch {
      // Keep the last good snapshot; the stream may still recover on its own.
    } finally {
      refreshingLiveDiscoveryRef.current = false;
    }
  }, [applyDiscoveryPayload]);

  useEffect(() => {
    const source = new EventSource(apiSseUrl("/api/me/home/discovery-stream?initial=0"));
    source.onopen = () => {
      const { reconnected } = markSseChannelOpen(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      if (reconnected) {
        void refreshLiveDiscovery();
      }
    };
    source.onmessage = (event) => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      try {
        const next = JSON.parse(event.data) as HomeDiscoveryPayload;
        applyDiscoveryPayload(next);
      } catch {
        // Ignore malformed snapshots and keep the last good payload.
      }
    };
    source.addEventListener("heartbeat", () => {
      markSseChannelEvent(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    });
    source.onerror = () => {
      markSseChannelError(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
    };
    return () => {
      markSseChannelClosed(HOME_DISCOVERY_SSE_CHANNEL, {
        degradeAfterMs: HOME_DISCOVERY_DEGRADE_AFTER_MS,
      });
      source.close();
    };
  }, [applyDiscoveryPayload, refreshLiveDiscovery]);

  useEffect(() => {
    return onSseChannelState(HOME_DISCOVERY_SSE_CHANNEL, (state) => {
      if (!state.degraded) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return;
      const now = Date.now();
      if (now - lastDegradedRefreshAtRef.current < HOME_DISCOVERY_DEGRADED_REFRESH_MS) return;
      lastDegradedRefreshAtRef.current = now;
      void refreshLiveDiscovery();
    });
  }, [refreshLiveDiscovery]);

  useEffect(() => {
    const maybeRecoverFromDegradedStream = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) return;
      const state = getSseChannelState(HOME_DISCOVERY_SSE_CHANNEL);
      if (!state?.degraded) return;
      void refreshLiveDiscovery();
    };
    window.addEventListener("online", maybeRecoverFromDegradedStream);
    document.addEventListener("visibilitychange", maybeRecoverFromDegradedStream);
    return () => {
      window.removeEventListener("online", maybeRecoverFromDegradedStream);
      document.removeEventListener("visibilitychange", maybeRecoverFromDegradedStream);
    };
  }, [refreshLiveDiscovery]);

  const currentDiscovery = liveDiscovery ?? discovery;
  // Normalize: backend now returns array, old cache may still return single object
  const heroRaw = currentDiscovery?.hero ?? null;
  const heroes: HomeHeroArtist[] = Array.isArray(heroRaw) ? heroRaw : heroRaw ? [heroRaw] : [];
  const recentGlobalArtists = currentDiscovery?.recent_global_artists || [];
  const upcoming = currentDiscovery?.upcoming;
  const replay = currentDiscovery?.replay as ReplayMix | undefined;
  const globalArtistsLoading = !currentDiscovery;

  const onRefresh = useCallback(async () => {
    await refreshLiveDiscovery(true);
    refetchDiscovery();
  }, [refetchDiscovery, refreshLiveDiscovery]);

  const { handlers: pullHandlers, pullDistance, refreshing } = usePullToRefresh(onRefresh);

  const replayPreview = (replay?.items || []).slice(0, 4);
  const upcomingPreview = (upcoming?.items || [])
    .filter((item) => item.is_upcoming)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);
  const homeInsights = (upcoming?.insights || []).slice(0, 2);

  const recommendedTracks = useMemo(
    () =>
      (currentDiscovery?.recommended_tracks || []).map((item) => toTrackRowData(item)),
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
    const queue: Track[] = replay.items.map((item) =>
      toPlayableTrack(item, {
        cover:
          item.artist && item.album
            ? albumCoverApiUrl({
                albumId: item.album_id,
                albumEntityUid: item.album_entity_uid,
                artistEntityUid: item.artist_entity_uid,
                albumSlug: item.album_slug,
                artistName: item.artist,
                albumName: item.album,
              })
            : undefined,
      }),
    );
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
