import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { api } from "@/lib/api";
import { PullIndicator } from "@/components/ui/PullIndicator";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { usePlayer, usePlayerActions, type Track } from "@/contexts/PlayerContext";
import {
  FromCrateSection,
  HomeLibrarySection,
  JustLandedSection,
} from "@/components/home/HomeLibrarySections";
import {
  ContinueListeningSection,
  HomeReplaySection,
  KeepQueueMovingSection,
} from "@/components/home/HomePlaybackSections";
import {
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import {
  HomeShowPrepSection,
  HomeUpcomingSection,
} from "@/components/home/HomeUpcomingSections";
import type {
  CuratedPlaylist,
  HomeUpcomingInsight,
  HomeUpcomingResponse,
  LibraryAddition,
  PaginatedArtistsResponse,
  PlaylistDetailData,
  ReplayMix,
  SavedAlbum,
  UserPlaylist,
} from "@/components/home/home-model";
import { albumCoverApiUrl } from "@/lib/library-routes";

function buildLibraryAdditions(
  playlists: UserPlaylist[],
  followedCurated: CuratedPlaylist[],
  savedAlbums: SavedAlbum[],
): LibraryAddition[] {
  return [
    ...playlists.map((playlist) => ({
      type: "playlist" as const,
      added_at: playlist.updated_at || playlist.created_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_cover_data_url: playlist.cover_data_url,
      playlist_track_count: playlist.track_count,
      playlist_badge: "Playlist",
    })),
    ...followedCurated.map((playlist) => ({
      type: "system_playlist" as const,
      added_at: playlist.followed_at || playlist.updated_at || "",
      playlist_id: playlist.id,
      playlist_name: playlist.name,
      playlist_description: playlist.description,
      playlist_tracks: playlist.artwork_tracks,
      playlist_track_count: playlist.track_count,
      playlist_follower_count: playlist.follower_count,
      playlist_badge: playlist.is_smart ? "Smart" : "Curated",
    })),
    ...savedAlbums.map((album) => ({
      type: "album" as const,
      added_at: album.saved_at || "",
      album_id: album.id,
      album_name: album.name,
      album_artist: album.artist,
      album_year: album.year,
      album_track_count: album.track_count,
      album_slug: album.slug,
      album_artist_id: album.artist_id,
      album_artist_slug: album.artist_slug,
    })),
  ]
    .sort((a, b) => b.added_at.localeCompare(a.added_at))
    .slice(0, 14);
}

interface HistoryTrack {
  track_id: number | null;
  track_path: string;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  navidrome_id?: string;
  played_at: string;
}

export function Home() {
  const navigate = useNavigate();
  const { currentTrack } = usePlayer();
  const { play, playAll } = usePlayerActions();

  const { data: curatedPlaylists, loading: curatedLoading, refetch: refetchCurated } =
    useApi<CuratedPlaylist[]>("/api/curation/playlists");
  const { data: followedCurated, loading: followedLoading, refetch: refetchFollowedCurated } =
    useApi<CuratedPlaylist[]>("/api/curation/followed");
  const { data: recentGlobalArtists, loading: globalArtistsLoading, refetch: refetchArtists } =
    useApi<PaginatedArtistsResponse>("/api/artists?sort=recent&per_page=10");
  const { data: savedAlbums, loading: savedAlbumsLoading, refetch: refetchAlbums } =
    useApi<SavedAlbum[]>("/api/me/albums");
  const { data: playlists, loading: playlistsLoading, refetch: refetchPlaylists } =
    useApi<UserPlaylist[]>("/api/playlists");
  const { data: upcoming, refetch: refetchUpcoming } =
    useApi<HomeUpcomingResponse>("/api/me/upcoming");
  const { data: replay, refetch: refetchReplay } =
    useApi<ReplayMix>("/api/me/stats/replay?window=30d&limit=18");
  const { data: historyRaw, refetch: refetchHistory } =
    useApi<HistoryTrack[]>("/api/me/history?limit=12");

  const onRefresh = useCallback(async () => {
    refetchCurated();
    refetchFollowedCurated();
    refetchArtists();
    refetchAlbums();
    refetchPlaylists();
    refetchUpcoming();
    refetchReplay();
    refetchHistory();
  }, [refetchCurated, refetchFollowedCurated, refetchArtists, refetchAlbums, refetchPlaylists, refetchUpcoming, refetchReplay, refetchHistory]);

  const { handlers: pullHandlers, pullDistance, refreshing } = usePullToRefresh(onRefresh);

  const recentlyPlayed: Track[] = useMemo(() => {
    if (!historyRaw) return [];
    const seen = new Set<string>();
    const tracks: Track[] = [];
    for (const h of historyRaw) {
      const key = h.track_path || String(h.track_id || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      tracks.push({
        id: h.track_path || String(h.track_id || ""),
        title: h.title,
        artist: h.artist,
        artistId: h.artist_id,
        artistSlug: h.artist_slug,
        album: h.album,
        albumId: h.album_id,
        albumSlug: h.album_slug,
        path: h.track_path,
        navidromeId: h.navidrome_id,
        libraryTrackId: h.track_id ?? undefined,
        albumCover: h.album_id != null
          ? albumCoverApiUrl({ albumId: h.album_id, albumSlug: h.album_slug, artistName: h.artist, albumName: h.album })
          : undefined,
      });
    }
    return tracks;
  }, [historyRaw]);

  const continueItems = currentTrack
    ? [currentTrack, ...recentlyPlayed.filter((track) => track.id !== currentTrack.id)]
    : recentlyPlayed;
  const continueLead = continueItems[0];
  const continueRail = continueItems.slice(1, 8);
  const upcomingPreview = (upcoming?.items || [])
    .filter((item) => item.is_upcoming)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 3);
  const homeInsights = (upcoming?.insights || []).slice(0, 2);
  const replayPreview = (replay?.items || []).slice(0, 4);
  const libraryAdditions = buildLibraryAdditions(
    playlists || [],
    followedCurated || [],
    savedAlbums || [],
  );
  const libraryAdditionsLoading =
    savedAlbumsLoading || playlistsLoading || followedLoading;

  async function handlePlayPlaylist(playlistId: number, systemPlaylist: boolean, playlistName: string) {
    try {
      const data = await api<PlaylistDetailData>(
        systemPlaylist ? `/api/curation/playlists/${playlistId}` : `/api/playlists/${playlistId}`,
      );
      const playerTracks: Track[] = (data.tracks || []).map((track) => ({
        id: track.track_path || String(track.id || track.track_id || Math.random()),
        title: track.title || "Unknown",
        artist: track.artist || "",
        album: track.album || "",
        albumCover:
          track.artist && track.album
            ? albumCoverApiUrl({ albumId: track.album_id, albumSlug: track.album_slug, artistName: track.artist, albumName: track.album })
            : data.cover_data_url || undefined,
        path: track.track_path,
        libraryTrackId: track.track_id,
        navidromeId: track.navidrome_id,
        artistId: track.artist_id,
        artistSlug: track.artist_slug,
        albumId: track.album_id,
        albumSlug: track.album_slug,
      }));
      if (playerTracks.length > 0) {
        playAll(playerTracks, 0, {
          type: "playlist",
          name: playlistName,
          radio: { seedType: "playlist", seedId: playlistId },
        });
      }
    } catch {
      toast.error("Failed to play playlist");
    }
  }

  async function handleToggleSystemPlaylistFollow(playlistId: number, isFollowed: boolean) {
    try {
      await api(`/api/curation/playlists/${playlistId}/follow`, isFollowed ? "DELETE" : "POST");
      toast.success(isFollowed ? "Removed from your library" : "Added to your library");
      refetchFollowedCurated();
    } catch {
      toast.error("Failed to update playlist");
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
      id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
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

        <ContinueListeningSection
          continueLead={continueLead}
          continueRail={continueRail}
          onPlayTrack={(track, sourceName) => play(track, { type: "track", name: sourceName })}
        />
      </div>

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
        onPlayTrack={(item) =>
          play(
            {
              id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
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
            },
            { type: "track", name: item.title },
          )
        }
      />

      <FromCrateSection
        playlists={curatedPlaylists || undefined}
        loading={curatedLoading}
        onPlayPlaylist={(playlistId, playlistName) =>
          void handlePlayPlaylist(playlistId, true, playlistName)
        }
        onToggleFollow={(playlistId, isFollowed) =>
          void handleToggleSystemPlaylistFollow(playlistId, isFollowed)
        }
        onOpenPlaylist={(playlistId) => navigate(`/curation/playlist/${playlistId}`)}
      />

      <HomeLibrarySection
        additions={libraryAdditions}
        loading={libraryAdditionsLoading}
        onOpenLibrary={() => navigate("/library")}
        onPlayPlaylist={(playlistId, isSystem, playlistName) =>
          void handlePlayPlaylist(playlistId, isSystem, playlistName)
        }
        onToggleSystemPlaylistFollow={(playlistId) =>
          void handleToggleSystemPlaylistFollow(playlistId, true)
        }
        onOpenPlaylist={(playlistId) => navigate(`/playlist/${playlistId}`)}
        onOpenSystemPlaylist={(playlistId) => navigate(`/curation/playlist/${playlistId}`)}
      />

      <JustLandedSection
        artists={recentGlobalArtists?.items}
        loading={globalArtistsLoading}
        onOpenExplore={() => navigate("/explore")}
      />

      <KeepQueueMovingSection
        tracks={continueRail}
        onPlayTrack={(track) => play(track, { type: "track", name: "Quick Pick" })}
      />
    </div>
  );
}
