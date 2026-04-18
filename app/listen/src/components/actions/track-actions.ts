import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  ArrowDownToLine,
  Loader2,
  Disc3,
  Heart,
  ListMusic,
  ListPlus,
  Play,
  Plus,
  Radio,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import {
  action,
  buildTrackMenuPlayerTrack,
  type TrackMenuData,
} from "@/components/actions/shared";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { getOfflineActionLabel, isOfflineBusy } from "@/lib/offline";
import { fetchTrackRadio } from "@/lib/radio";

interface UseTrackActionEntriesInput {
  track: TrackMenuData;
  albumCover?: string;
  playlistOptions?: Array<{ id: number; name: string }>;
  onAddToPlaylist?: (playlistId: number, track: TrackMenuData) => void | Promise<void>;
  onCreatePlaylist?: (track: TrackMenuData) => void | Promise<void>;
  /**
   * Override for the "Play now" entry. In queue contexts this should call
   * `jumpTo(index)` instead of the default `play(playerTrack)`, otherwise
   * selecting "Play now" from a queue row would reset the queue to a single track.
   */
  onPlayNowOverride?: () => void | Promise<void>;
}

export function useTrackActionEntries(input: UseTrackActionEntriesInput): ItemActionMenuEntry[] {
  const navigate = useNavigate();
  const { play, playAll, addToQueue, playNext } = usePlayerActions();
  const { isLiked, toggleTrackLike } = useLikedTracks();
  const { supported: offlineSupported, getTrackState, toggleTrackOffline } = useOffline();

  const libraryTrackId =
    input.track.library_track_id ?? (typeof input.track.id === "number" ? input.track.id : null);
  const trackStorageId = input.track.storage_id ?? null;
  const liked = isLiked(libraryTrackId, trackStorageId, input.track.path);
  const offlineState = getTrackState(trackStorageId);

  return useMemo<ItemActionMenuEntry[]>(() => {
    const playerTrack = buildTrackMenuPlayerTrack(input.track, input.albumCover);
    const entries: ItemActionMenuEntry[] = [
      action({
        key: "play",
        label: "Play now",
        icon: Play,
        onSelect: () => (input.onPlayNowOverride ? input.onPlayNowOverride() : play(playerTrack)),
      }),
      action({
        key: "play-next",
        label: "Play next",
        icon: ListPlus,
        onSelect: () => playNext(playerTrack),
      }),
      action({
        key: "queue",
        label: "Add to queue",
        icon: Plus,
        onSelect: () => addToQueue(playerTrack),
      }),
      { type: "divider", key: "divider-playback" },
      action({
        key: "like",
        label: liked ? "Unlike track" : "Like track",
        icon: Heart,
        active: liked,
        disabled: libraryTrackId == null && !trackStorageId,
        onSelect: async () => {
          await toggleTrackLike(libraryTrackId, trackStorageId, input.track.path);
          toast.success(liked ? "Removed from liked tracks" : "Added to liked tracks");
        },
      }),
      action({
        key: "radio",
        label: "Start track radio",
        icon: Radio,
        disabled: libraryTrackId == null && !trackStorageId && !input.track.path,
        onSelect: async () => {
          try {
            const radio = await fetchTrackRadio({
              libraryTrackId,
              storageId: trackStorageId,
              path: input.track.path,
              title: input.track.title,
            });
            if (!radio.tracks.length) {
              toast.info("Track radio is not available yet");
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error("Failed to start track radio");
          }
        },
      }),
      action({
        key: "offline",
        label: getOfflineActionLabel(offlineState),
        icon: isOfflineBusy(offlineState) ? Loader2 : ArrowDownToLine,
        active: offlineState === "ready",
        disabled: !offlineSupported || !trackStorageId || isOfflineBusy(offlineState),
        onSelect: async () => {
          try {
            const result = await toggleTrackOffline({ storageId: trackStorageId, title: input.track.title });
            toast.success(result === "removed" ? "Offline copy removed" : "Track available offline");
          } catch (error) {
            toast.error((error as Error).message || "Failed to update offline copy");
          }
        },
      }),
    ];

    if (input.onCreatePlaylist || (input.playlistOptions?.length ?? 0) > 0) {
      entries.push({ type: "divider", key: "divider-playlists" });
      entries.push({ type: "label", key: "playlists-label", label: "Playlists" });
      if (input.onCreatePlaylist) {
        entries.push(action({
          key: "playlist-create",
          label: "Add to new playlist",
          icon: ListMusic,
          onSelect: async () => {
            await input.onCreatePlaylist?.(input.track);
          },
        }));
      }
      for (const playlist of input.playlistOptions || []) {
        entries.push(action({
          key: `playlist-${playlist.id}`,
          label: `Add to ${playlist.name}`,
          icon: ListMusic,
          onSelect: async () => {
            await input.onAddToPlaylist?.(playlist.id, input.track);
            toast.success("Track added to playlist");
          },
        }));
      }
    }

    if (input.track.artist_id != null || input.track.album_id != null) {
      entries.push({ type: "divider", key: "divider-links" });
    }

    if (input.track.artist_id != null) {
      entries.push(action({
        key: "artist",
        label: "Go to artist",
        icon: UserRound,
        onSelect: () => navigate(artistPagePath({
          artistId: input.track.artist_id,
          artistSlug: input.track.artist_slug,
          artistName: input.track.artist,
        })),
      }));
    }

    if (input.track.album_id != null) {
      entries.push(action({
        key: "album",
        label: "Go to album",
        icon: Disc3,
        onSelect: () => navigate(albumPagePath({
          albumId: input.track.album_id,
          albumSlug: input.track.album_slug,
          artistName: input.track.artist,
          albumName: input.track.album,
        })),
      }));
    }

    return entries;
  }, [
    addToQueue,
    input.albumCover,
    input.onAddToPlaylist,
    input.onCreatePlaylist,
    input.onPlayNowOverride,
    input.playlistOptions,
    input.track,
    liked,
    libraryTrackId,
    offlineState,
    offlineSupported,
    trackStorageId,
    navigate,
    play,
    playAll,
    playNext,
    toggleTrackOffline,
    toggleTrackLike,
  ]);
}
