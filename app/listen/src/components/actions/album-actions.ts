import { useMemo } from "react";
import { Heart, Play, Radio, Share2, Shuffle } from "lucide-react";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import {
  action,
  fetchAlbumTracks,
  sharePath,
  type AlbumMenuData,
} from "@/components/actions/shared";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useSavedAlbums } from "@/contexts/SavedAlbumsContext";
import { albumPagePath } from "@/lib/library-routes";
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
  const saved = isSaved(input.albumId);

  return useMemo<ItemActionMenuEntry[]>(() => {
    const albumPath = albumPagePath({
      albumId: input.albumId,
      albumSlug: input.albumSlug,
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
        key: "share",
        label: "Share album",
        icon: Share2,
        onSelect: sharePath(albumPath, `${input.artist} - ${input.album}`),
      }),
    ];
  }, [input, playAll, saved, toggleAlbumSaved]);
}
