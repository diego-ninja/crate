import { useEffect, useState } from "react";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { fetchPlayableSetlist } from "@/lib/upcoming";

import type { UpcomingItem } from "./upcoming-model";

export function useUpcomingShowActions(
  item: UpcomingItem,
  onAttendanceChange?: (attending: boolean) => void,
) {
  const { playAll } = usePlayerActions();
  const [attending, setAttending] = useState(Boolean(item.user_attending));
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [playingSetlist, setPlayingSetlist] = useState(false);

  useEffect(() => {
    setAttending(Boolean(item.user_attending));
  }, [item.user_attending]);

  async function toggleAttendance() {
    if (!item.id) return;
    setSavingAttendance(true);
    try {
      if (attending) {
        await api(`/api/me/shows/${item.id}/attendance`, "DELETE");
        setAttending(false);
        onAttendanceChange?.(false);
        toast.success("Removed from your concert plan");
      } else {
        await api(`/api/me/shows/${item.id}/attendance`, "POST");
        setAttending(true);
        onAttendanceChange?.(true);
        toast.success("Marked as attending");
      }
    } catch {
      toast.error("Failed to update attendance");
    } finally {
      setSavingAttendance(false);
    }
  }

  async function playProbableSetlist() {
    if (!item.probable_setlist?.length) {
      toast.info("No probable setlist available for this show");
      return;
    }
    try {
      setPlayingSetlist(true);
      const queue = await fetchPlayableSetlist(item.artist);
      if (!queue.length) {
        toast.info(`None of the ${item.probable_setlist.length} setlist tracks were found in your library`);
        return;
      }
      playAll(queue, 0, { type: "playlist", name: `${item.artist} Probable Setlist` });
      toast.success(`Playing probable setlist: ${queue.length} tracks`);
    } catch {
      toast.error("Failed to load probable setlist");
    } finally {
      setPlayingSetlist(false);
    }
  }

  return {
    attending,
    savingAttendance,
    playingSetlist,
    toggleAttendance,
    playProbableSetlist,
  };
}
