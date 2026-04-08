import { useMemo } from "react";
import { Check, Mic2, Music2, Ticket } from "lucide-react";
import { useNavigate } from "react-router";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import { action } from "@/components/actions/shared";
import { artistPagePath } from "@/lib/library-routes";
import type { UpcomingItem } from "@/components/upcoming/upcoming-model";

interface UseShowActionEntriesInput {
  item: UpcomingItem;
  attending: boolean;
  toggleAttendance: () => Promise<void>;
  playProbableSetlist: () => Promise<void>;
}

export function useShowActionEntries(input: UseShowActionEntriesInput): ItemActionMenuEntry[] {
  const navigate = useNavigate();

  return useMemo<ItemActionMenuEntry[]>(() => [
    action({
      key: "attendance",
      label: input.attending ? "Remove attendance" : "Mark as attending",
      icon: Check,
      active: input.attending,
      disabled: input.item.id == null,
      onSelect: input.toggleAttendance,
    }),
    action({
      key: "setlist",
      label: "Play probable setlist",
      icon: Music2,
      disabled: !input.item.probable_setlist?.length || input.item.artist_id == null,
      onSelect: input.playProbableSetlist,
    }),
    action({
      key: "artist",
      label: "Open artist",
      icon: Mic2,
      disabled: input.item.artist_id == null,
      onSelect: () => {
        navigate(artistPagePath({
          artistId: input.item.artist_id,
          artistSlug: input.item.artist_slug,
          artistName: input.item.artist,
        }));
      },
    }),
    action({
      key: "tickets",
      label: "Open tickets",
      icon: Ticket,
      disabled: !input.item.url,
      onSelect: () => {
        if (!input.item.url) return;
        window.open(input.item.url, "_blank", "noopener,noreferrer");
      },
    }),
  ], [
    input.attending,
    input.item,
    input.playProbableSetlist,
    input.toggleAttendance,
    navigate,
  ]);
}
