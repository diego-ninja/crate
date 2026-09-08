import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { shuffleArray } from "@/lib/utils";
import {
  toPlayerTracks,
  type PlaylistDetailResponse,
} from "@/components/playlists/playlist-list-row-model";

export function usePlaylistListRowPlayback({
  detailEndpoint,
  name,
  playlistId,
}: {
  detailEndpoint: string;
  name: string;
  playlistId?: number;
}) {
  const { t } = useTranslation();
  const { playAll } = usePlayerActions();
  const [playingMode, setPlayingMode] = useState<"play" | "shuffle" | null>(
    null,
  );

  const loadAndPlay = useCallback(
    async (mode: "play" | "shuffle") => {
      setPlayingMode(mode);
      try {
        const response = await api<PlaylistDetailResponse>(detailEndpoint);
        const tracks = toPlayerTracks(response.tracks || []);
        if (tracks.length === 0) {
          toast.message(t("playlist.toasts.noPlayableTracks"));
          return;
        }
        const queue = mode === "shuffle" ? shuffleArray(tracks) : tracks;
        playAll(queue, 0, {
          type: "playlist",
          name,
          radio:
            playlistId != null
              ? { seedType: "playlist", seedId: playlistId }
              : undefined,
        });
      } catch {
        toast.error(t("home.playlists.loadFailed"));
      } finally {
        setPlayingMode(null);
      }
    },
    [detailEndpoint, name, playAll, playlistId, t],
  );

  return { loadAndPlay, playingMode };
}
