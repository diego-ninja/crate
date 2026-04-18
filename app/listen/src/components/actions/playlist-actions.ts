import { useMemo } from "react";
import { ArrowDownToLine, Heart, Loader2, Play, Radio, Share2, Shuffle } from "lucide-react";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import {
  action,
  sharePath,
  type PlaylistMenuData,
} from "@/components/actions/shared";
import { useOffline } from "@/contexts/OfflineContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { getOfflineActionLabel, isOfflineBusy } from "@/lib/offline";
import { fetchPlaylistRadio } from "@/lib/radio";

export function usePlaylistActionEntries(input: PlaylistMenuData): ItemActionMenuEntry[] {
  const { playAll } = usePlayerActions();
  const { supported: offlineSupported, getPlaylistState, togglePlaylistOffline } = useOffline();
  const offlineState = getPlaylistState(input.playlistId);

  return useMemo<ItemActionMenuEntry[]>(() => {
    const entries: ItemActionMenuEntry[] = [];

    if (input.onPlay) {
      entries.push(action({
        key: "play",
        label: "Play playlist",
        icon: Play,
        onSelect: async () => {
          await input.onPlay?.();
        },
      }));
    }

    if (input.onShuffle) {
      entries.push(action({
        key: "shuffle",
        label: "Shuffle playlist",
        icon: Shuffle,
        onSelect: async () => {
          await input.onShuffle?.();
        },
      }));
    }

    if (input.onStartRadio) {
      entries.push(action({
        key: "radio",
        label: "Start playlist radio",
        icon: Radio,
        onSelect: async () => {
          await input.onStartRadio?.();
        },
      }));
    } else if (input.playlistId != null) {
      const playlistId = input.playlistId;
      entries.push(action({
        key: "radio",
        label: "Start playlist radio",
        icon: Radio,
        onSelect: async () => {
          try {
            const radio = await fetchPlaylistRadio({
              playlistId,
              playlistName: input.name,
            });
            if (!radio.tracks.length) {
              toast.info("Playlist radio is not available yet");
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error("Failed to start playlist radio");
          }
        },
      }));
    }

    if (input.canFollow && input.onToggleFollow) {
      entries.push({ type: "divider", key: "divider-playlist-follow" });
      entries.push(action({
        key: "follow",
        label: input.isFollowed ? "Remove from your library" : "Add to your library",
        icon: Heart,
        active: input.isFollowed,
        onSelect: async () => {
          await input.onToggleFollow?.();
        },
      }));
    }

    entries.push({ type: "divider", key: "divider-playlist-offline" });
    entries.push(action({
      key: "offline",
      label:
        input.isSmart
          ? "Offline is only available for static playlists"
          : getOfflineActionLabel(offlineState),
      icon: isOfflineBusy(offlineState) ? Loader2 : ArrowDownToLine,
      active: offlineState === "ready",
      disabled:
        !offlineSupported ||
        input.playlistId == null ||
        Boolean(input.isSmart) ||
        isOfflineBusy(offlineState),
      onSelect: async () => {
        try {
          const result = await togglePlaylistOffline({
            playlistId: input.playlistId,
            title: input.name,
            isSmart: input.isSmart,
          });
          toast.success(result === "removed" ? "Offline copy removed" : "Playlist available offline");
        } catch (error) {
          toast.error((error as Error).message || "Failed to update offline copy");
        }
      },
    }));

    if (input.href) {
      entries.push({ type: "divider", key: "divider-playlist-share" });
      entries.push(action({
        key: "share",
        label: "Share playlist",
        icon: Share2,
        onSelect: sharePath(input.href, input.name),
      }));
    }

    return entries;
  }, [input, offlineState, offlineSupported, playAll, togglePlaylistOffline]);
}
