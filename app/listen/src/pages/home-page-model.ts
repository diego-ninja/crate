import type {
  HomeDiscoveryPayload,
  HomeHeroArtist,
  HomeRecommendedTrack,
  HomeSectionId,
  HomeUpcomingInsight,
  HomeUpcomingItem,
  ReplayMix,
} from "@/components/home/home-model";
import {
  homeUpcomingAlbumKey,
  selectHomeRadarItems,
} from "@/components/home/home-model";
import type { Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { toTrackRowData } from "@/lib/track-row-data";

export interface HomePageViewModel {
  currentDiscovery: HomeDiscoveryPayload;
  heroes: HomeHeroArtist[];
  recentGlobalArtists: HomeDiscoveryPayload["recent_global_artists"];
  upcoming: HomeDiscoveryPayload["upcoming"];
  replay: ReplayMix | undefined;
  replayMonth: string | undefined;
  globalArtistsLoading: boolean;
  replayPreview: ReplayMix["items"];
  upcomingPreview: HomeUpcomingItem[];
  homeInsights: HomeUpcomingInsight[];
  recommendedTracks: ReturnType<typeof toTrackRowData>[];
}

export function buildHomePageViewModel(
  currentDiscovery: HomeDiscoveryPayload,
): HomePageViewModel {
  const heroRaw = currentDiscovery.hero ?? null;
  const heroes: HomeHeroArtist[] = Array.isArray(heroRaw)
    ? heroRaw
    : heroRaw
      ? [heroRaw]
      : [];
  const upcoming = currentDiscovery.upcoming;
  const replay = currentDiscovery.replay as ReplayMix | undefined;
  const replayMonth = replay?.window?.startsWith("month:")
    ? replay.window.slice(6)
    : undefined;
  const replayPreview = (replay?.items || []).slice(0, 4);
  const upcomingAlbumKeys = new Set(
    (currentDiscovery.upcoming_albums || []).map((album) =>
      homeUpcomingAlbumKey(album.artist_name, album.album_name),
    ),
  );

  return {
    currentDiscovery,
    heroes,
    recentGlobalArtists: currentDiscovery.recent_global_artists || [],
    upcoming,
    replay,
    replayMonth,
    globalArtistsLoading: false,
    replayPreview,
    upcomingPreview: selectHomeRadarItems(
      upcoming?.items || [],
      upcomingAlbumKeys,
    ),
    homeInsights: (upcoming?.insights || []).slice(0, 2),
    recommendedTracks: (currentDiscovery.recommended_tracks || []).map(
      (item: HomeRecommendedTrack) => toTrackRowData(item),
    ),
  };
}

export function toPlayerTrack(item: HomeRecommendedTrack): Track {
  return toPlayableTrack(item, {
    cover:
      item.artist && item.album
        ? albumCoverApiUrl(
            {
              albumId: item.album_id,
              globalAlbumUid: item.global_album_uid,
              albumEntityUid: item.album_entity_uid,
              artistEntityUid: item.artist_entity_uid,
              albumSlug: item.album_slug,
              artistName: item.artist,
              albumName: item.album,
            },
            { size: 512 },
          ) || undefined
        : undefined,
  });
}

export function homeSectionPath(sectionId: HomeSectionId): string {
  return `/home/section/${sectionId}`;
}

export function homePlaylistPath(playlistId: string): string {
  return `/home/playlist/${encodeURIComponent(playlistId)}`;
}
