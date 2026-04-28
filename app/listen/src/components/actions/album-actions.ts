import { useMemo } from "react";
import { ArrowDownToLine, Heart, Loader2, Play, Radio, Share2, Shuffle } from "lucide-react";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import {
  action,
  fetchAlbumTracks,
  sharePath,
  type AlbumMenuData,
} from "@/components/actions/shared";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useOffline } from "@/contexts/OfflineContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { albumPagePath } from "@/lib/library-routes";
import { getOfflineActionLabel, isOfflineBusy } from "@/lib/offline";
import { fetchAlbumRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";

function albumPlaySource(data: AlbumMenuData): PlaySource {
  return {
    type: "album",
    name: `${data.artist} - ${data.album}`,
    radio: data.albumId != null ? { seedType: "album", seedId: data.albumId } : undefined,
  };
}

export function useAlbumActionEntries(input: AlbumMenuData): ItemActionMenuEntry[] {
  const { playAll } = usePlayerActions();
  const { isSaved, toggleAlbumSaved } = useSavedAlbums();
  const { supported: offlineSupported, getAlbumState, toggleAlbumOffline } = useOffline();
  const saved = isSaved(input.albumId);
  const offlineState = getAlbumState(input.albumId);

  return useMemo<ItemActionMenuEntry[]>(() => {
    const albumPath = albumPagePath({
      albumId: input.albumId,
      albumSlug: input.albumSlug,
      artistSlug: input.artistSlug,
      artistName: input.artist,
      albumName: input.album,
    });

    return [
      action({
        key: "play",
        label: "Play album",
        icon: Play,
        onSelect: async () => {
          try {
            const tracks = await fetchAlbumTracks(input);
            if (!tracks.length) {
              toast.info("This album has no playable tracks yet");
              return;
            }
            playAll(tracks, 0, albumPlaySource(input));
          } catch {
            toast.error("Failed to load album");
          }
        },
      }),
      action({
        key: "shuffle",
        label: "Shuffle album",
        icon: Shuffle,
        onSelect: async () => {
          try {
            const tracks = await fetchAlbumTracks(input);
            if (!tracks.length) {
              toast.info("This album has no playable tracks yet");
              return;
            }
            playAll(shuffleArray(tracks), 0, albumPlaySource(input));
          } catch {
            toast.error("Failed to load album");
          }
        },
      }),
      { type: "divider", key: "divider-album-main" },
      action({
        key: "save",
        label: saved ? "Remove from saved albums" : "Save album",
        icon: Heart,
        active: saved,
        disabled: input.albumId == null,
        onSelect: async () => {
          await toggleAlbumSaved(input.albumId ?? null);
          toast.success(saved ? "Removed from saved albums" : "Album saved");
        },
      }),
      action({
        key: "radio",
        label: "Start album radio",
        icon: Radio,
        disabled: input.albumId == null,
        onSelect: async () => {
          if (input.albumId == null) return;
          try {
            const radio = await fetchAlbumRadio({
              albumId: input.albumId,
              artistName: input.artist,
              albumName: input.album,
            });
            if (!radio.tracks.length) {
              toast.info("Album radio is not available yet");
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error("Failed to start album radio");
          }
        },
      }),
      action({
        key: "offline",
        label: getOfflineActionLabel(offlineState),
        icon: isOfflineBusy(offlineState) ? Loader2 : ArrowDownToLine,
        active: offlineState === "ready",
        disabled: !offlineSupported || input.albumId == null || isOfflineBusy(offlineState),
        onSelect: async () => {
          try {
            const result = await toggleAlbumOffline({ albumId: input.albumId, title: input.album });
            toast.success(result === "removed" ? "Offline copy removed" : "Album available offline");
          } catch (error) {
            toast.error((error as Error).message || "Failed to update offline copy");
          }
        },
      }),
      action({
        key: "share",
        label: "Share album",
        icon: Share2,
        onSelect: sharePath(albumPath, `${input.artist} - ${input.album}`),
      }),
    ];
  }, [input, offlineState, offlineSupported, playAll, saved, toggleAlbumOffline, toggleAlbumSaved]);
}
