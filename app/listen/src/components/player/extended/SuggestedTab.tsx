import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Star } from "@crate/ui/icons";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  hasPlayableTrackReference,
  toPlayableTrack,
} from "@/lib/playable-track";
import { fetchTrackRadio } from "@/lib/radio";

import { SuggestedTrackRow } from "./SuggestedTrackRow";
import { useSuggestedTracks } from "./use-suggested-tracks";

export function SuggestedTab() {
  const { t } = useTranslation();
  const { currentTrack, play, playAll } = usePlayerActions();
  const { tracks, loading } = useSuggestedTracks(currentTrack);
  const [startingRadio, setStartingRadio] = useState(false);

  const handlePlay = useCallback(
    (track: (typeof tracks)[number]) => {
      if (!currentTrack) return;
      play(
        toPlayableTrack({
          ...track,
          id: track.track_id ?? track.path,
          library_track_id: track.track_id,
        }),
        {
          type: "radio",
          name: t("player.suggested.playSource", {
            title: currentTrack.title,
          }),
        },
      );
    },
    [currentTrack, play, t],
  );

  async function handleStartTrackRadio() {
    if (!currentTrack) return;
    try {
      setStartingRadio(true);
      const radio = await fetchTrackRadio({
        libraryTrackId: currentTrack.libraryTrackId ?? null,
        entityUid: currentTrack.entityUid ?? null,
        path: currentTrack.path ?? null,
        title: currentTrack.title,
      });
      if (!radio.tracks.length) {
        toast.info(t("actions.track.toasts.radioUnavailable"));
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error(t("actions.track.toasts.radioFailed"));
    } finally {
      setStartingRadio(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-accent-action" />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-primary/20">
        {t("player.suggested.empty")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <div className="mb-3 px-1">
        <button
          onClick={handleStartTrackRadio}
          disabled={
            startingRadio ||
            !currentTrack ||
            !hasPlayableTrackReference(currentTrack)
          }
          className="inline-flex items-center gap-2 rounded-full border border-border-quiet bg-text-primary/5 px-3 py-1.5 text-xs font-medium text-text-primary/80 transition hover:bg-text-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {startingRadio ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Star size={12} />
          )}
          {t("actions.track.radio")}
        </button>
      </div>
      {tracks.map((track, index) => (
        <SuggestedTrackRow
          key={track.track_entity_uid ?? track.track_id ?? track.path}
          track={track}
          index={index}
          onPlay={handlePlay}
        />
      ))}
    </div>
  );
}
