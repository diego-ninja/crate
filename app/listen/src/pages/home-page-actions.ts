import type { TFunction } from "i18next";
import { toast } from "sonner";

import { fetchArtistTopTracks } from "@/components/actions/shared";
import type {
  HomeGeneratedPlaylistDetail,
  HomeGeneratedPlaylistSummary,
  HomeHeroArtist,
  HomeUpcomingInsight,
  HomeUpcomingItem,
  ReplayMix,
} from "@/components/home/home-model";
import type { Track } from "@/contexts/PlayerContext";
import type { PlayerActionsValue } from "@/contexts/player-context";
import { api } from "@/lib/api";
import { fetchHomePlaylistRadio } from "@/lib/radio";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { albumCoverApiUrl, artistPagePath } from "@/lib/library-routes";
import { toPlayableTrack } from "@/lib/playable-track";
import { shuffleArray } from "@/lib/utils";
import { toPlayerTrack } from "@/pages/home-page-model";

interface HomePageActionInput {
  navigate: (to: string) => void;
  play: PlayerActionsValue["play"];
  playAll: PlayerActionsValue["playAll"];
  refetchDiscovery: () => void;
  replay: ReplayMix | undefined;
  replayMonth: string | undefined;
  t: TFunction;
  toggleArtistFollow: (artistId: number) => Promise<unknown>;
}

export interface HomePageActions {
  acknowledgeInsight: (insight: HomeUpcomingInsight) => Promise<void>;
  openHomeSection: (sectionId: string) => void;
  openReplayStats: () => void;
  playHeroArtist: (artist: HomeHeroArtist) => Promise<void>;
  playHomePlaylist: (item: HomeGeneratedPlaylistSummary) => Promise<void>;
  playInsightSetlist: (insight: HomeUpcomingInsight) => Promise<void>;
  playReplayMix: () => void;
  playReplayTrack: (item: ReplayMix["items"][number]) => void;
  playUpcomingSetlist: (item: HomeUpcomingItem) => Promise<void>;
  shuffleHomePlaylist: (item: HomeGeneratedPlaylistSummary) => Promise<void>;
  startHomePlaylistRadio: (item: HomeGeneratedPlaylistSummary) => Promise<void>;
  toggleHeroFollow: (artist: HomeHeroArtist) => Promise<void>;
  openArtist: (artist: HomeHeroArtist) => void;
}

export function buildHomePageActions({
  navigate,
  play,
  playAll,
  refetchDiscovery,
  replay,
  replayMonth,
  t,
  toggleArtistFollow,
}: HomePageActionInput): HomePageActions {
  function openHomeSection(sectionId: string) {
    navigate(`/home/section/${sectionId}`);
  }

  function openArtist(artist: HomeHeroArtist) {
    navigate(
      artistPagePath({
        artistId: artist.id,
        artistSlug: artist.slug,
        artistName: artist.name,
      }),
    );
  }

  async function playHeroArtist(artist: HomeHeroArtist) {
    try {
      const queue = await fetchArtistTopTracks({
        artistId: artist.id,
        artistSlug: artist.slug,
        name: artist.name,
      });
      if (!queue.length) {
        toast.info(t("actions.artist.toasts.noTopTracks"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("actions.artist.topTracksSource", { name: artist.name }),
        radio: { seedType: "artist", seedId: artist.id },
      });
    } catch {
      toast.error(t("actions.artist.toasts.loadTopTracksFailed"));
    }
  }

  async function toggleHeroFollow(artist: HomeHeroArtist) {
    try {
      await toggleArtistFollow(artist.id);
      refetchDiscovery();
    } catch {
      // Follow state rolls back in ArtistFollowsContext.
    }
  }

  async function loadHomePlaylist(playlistId: string) {
    return api<HomeGeneratedPlaylistDetail>(
      `/api/me/home/playlists/${encodeURIComponent(playlistId)}`,
    );
  }

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

  async function acknowledgeInsight(insight: HomeUpcomingInsight) {
    try {
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(t("home.radar.toasts.savedForLater"));
      navigate("/upcoming");
    } catch {
      toast.error(t("home.radar.toasts.saveReminderFailed"));
    }
  }

  async function playInsightSetlist(insight: HomeUpcomingInsight) {
    try {
      if (!insight.artist_id) return;
      const queue = await fetchPlayableSetlist({
        artistId: insight.artist_id,
        artistName: insight.artist,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("radar.show.probableSetlistSource", {
          name: insight.artist,
        }),
      });
      await api(`/api/me/shows/${insight.show_id}/reminders`, "POST", {
        reminder_type: insight.type,
      });
      toast.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      toast.error(t("radar.show.toasts.loadSetlistFailed"));
    }
  }

  async function playUpcomingSetlist(item: HomeUpcomingItem) {
    try {
      if (item.type !== "show" || !item.artist_id) return;
      const queue = await fetchPlayableSetlist({
        artistId: item.artist_id,
        artistName: item.artist,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("radar.show.probableSetlistSource", { name: item.artist }),
      });
      toast.success(
        t("radar.show.toasts.playingSetlist", { count: queue.length }),
      );
    } catch {
      toast.error(t("radar.show.toasts.loadSetlistFailed"));
    }
  }

  function playReplayMix() {
    if (!replay?.items?.length) return;
    const queue: Track[] = replay.items.map((item) =>
      toPlayableTrack(item, {
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
      }),
    );
    playAll(queue, 0, { type: "playlist", name: replay.title });
  }

  function openReplayStats() {
    navigate(
      replayMonth
        ? `/stats?month=${encodeURIComponent(replayMonth)}`
        : "/stats",
    );
  }

  function playReplayTrack(item: ReplayMix["items"][number]) {
    play(toPlayerTrack(item), { type: "track", name: item.title });
  }

  return {
    acknowledgeInsight,
    openHomeSection,
    openReplayStats,
    playHeroArtist,
    playHomePlaylist,
    playInsightSetlist,
    playReplayMix,
    playReplayTrack,
    playUpcomingSetlist,
    shuffleHomePlaylist,
    startHomePlaylistRadio,
    toggleHeroFollow,
    openArtist,
  };
}
