import { useMemo } from "react";
import { Play, Radio, Share2, Shuffle, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import {
  action,
  fetchArtistTopTracks,
  sharePath,
  type ArtistMenuData,
} from "@/components/actions/shared";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { artistPagePath } from "@/lib/library-routes";
import { fetchArtistRadio } from "@/lib/radio";
import { shuffleArray } from "@/lib/utils";

export function useArtistActionEntries(input: ArtistMenuData): ItemActionMenuEntry[] {
  const { playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const following = isFollowing(input.artistId);

  return useMemo<ItemActionMenuEntry[]>(() => {
    const artistPath = artistPagePath({
      artistId: input.artistId,
      artistSlug: input.artistSlug,
      artistName: input.name,
    });

    return [
      action({
        key: "play",
        label: "Play top tracks",
        icon: Play,
        disabled: input.artistId == null,
        onSelect: async () => {
          if (input.artistId == null) return;
          try {
            const tracks = await fetchArtistTopTracks(input);
            if (!tracks.length) {
              toast.info("No top tracks available for this artist yet");
              return;
            }
            playAll(tracks, 0, { type: "queue", name: `${input.name} Top Tracks` });
          } catch {
            toast.error("Failed to load top tracks");
          }
        },
      }),
      action({
        key: "shuffle",
        label: "Shuffle top tracks",
        icon: Shuffle,
        disabled: input.artistId == null,
        onSelect: async () => {
          if (input.artistId == null) return;
          try {
            const tracks = await fetchArtistTopTracks(input);
            if (!tracks.length) {
              toast.info("No top tracks available for this artist yet");
              return;
            }
            playAll(shuffleArray(tracks), 0, { type: "queue", name: `${input.name} Top Tracks` });
          } catch {
            toast.error("Failed to load top tracks");
          }
        },
      }),
      { type: "divider", key: "divider-artist-main" },
      action({
        key: "follow",
        label: following ? "Unfollow artist" : "Follow artist",
        icon: following ? UserMinus : UserPlus,
        active: following,
        disabled: input.artistId == null,
        onSelect: async () => {
          await toggleArtistFollow(input.artistId ?? null);
          toast.success(following ? `Unfollowed ${input.name}` : `Following ${input.name}`);
        },
      }),
      action({
        key: "radio",
        label: "Start artist radio",
        icon: Radio,
        disabled: input.artistId == null,
        onSelect: async () => {
          if (input.artistId == null) return;
          try {
            const radio = await fetchArtistRadio(input.artistId, input.name);
            if (!radio.tracks.length) {
              toast.info("Artist radio is not available yet");
              return;
            }
            playAll(radio.tracks, 0, radio.source);
          } catch {
            toast.error("Failed to start artist radio");
          }
        },
      }),
      action({
        key: "share",
        label: "Share artist",
        icon: Share2,
        onSelect: sharePath(artistPath, input.name),
      }),
    ];
  }, [following, input, playAll, toggleArtistFollow]);
}
