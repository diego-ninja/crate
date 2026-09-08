import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { JamQueueLockedNotice } from "@/components/player/JamQueueLockedNotice";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { getPlaySourceLabel } from "@/components/player/player-source";

import { QueueTabCurrentTrack } from "./QueueTabCurrentTrack";
import { QueueTabPastTracks } from "./QueueTabPastTracks";
import { QueueTabUpcoming } from "./QueueTabUpcoming";

export function QueueTab() {
  const { t } = useTranslation();
  const { isPlaying } = usePlayerState();
  const {
    queue,
    currentIndex,
    playSource,
    currentTrack,
    jumpTo,
    removeFromQueue,
    jamQueueLocked,
  } = usePlayerActions();

  const history = queue.slice(0, currentIndex).reverse();
  const upcoming = queue.slice(currentIndex + 1);
  const sourceName = getPlaySourceLabel(playSource) || t("player.queue");

  async function handleSaveAsPlaylist() {
    const validTracks = queue.filter(
      (track) => track.path && track.path.includes("/"),
    );
    if (!validTracks.length) {
      toast.error(t("player.queue.toasts.noLocalTracks"));
      return;
    }
    try {
      await api("/api/playlists", "POST", {
        name: getPlaySourceLabel(playSource) || t("player.queue"),
        tracks: validTracks.map((track) => ({
          path: track.path,
          title: track.title,
          artist: track.artist,
          album: track.album || "",
        })),
      });
      toast.success(
        t("player.queue.toasts.saved", { count: validTracks.length }),
      );
    } catch {
      toast.error(t("player.queue.toasts.saveFailed"));
    }
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      {jamQueueLocked ? <JamQueueLockedNotice /> : null}
      <QueueTabPastTracks
        tracks={history}
        currentIndex={currentIndex}
        onJump={jumpTo}
        locked={jamQueueLocked}
      />
      {currentTrack ? (
        <QueueTabCurrentTrack
          currentTrack={currentTrack}
          currentIndex={currentIndex}
          isPlaying={isPlaying}
          sourceName={sourceName}
          onSave={() => void handleSaveAsPlaylist()}
        />
      ) : null}
      <QueueTabUpcoming
        tracks={upcoming}
        currentIndex={currentIndex}
        sourceName={sourceName}
        locked={jamQueueLocked}
        onJump={jumpTo}
        onRemove={removeFromQueue}
      />
      {upcoming.length === 0 && !currentTrack ? (
        <div className="py-12 text-center text-sm text-text-faint">
          {t("player.queue.empty")}
        </div>
      ) : null}
    </div>
  );
}
