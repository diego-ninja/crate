import { useEffect, useState } from "react";
import { Loader2, Star } from "lucide-react";
import { toast } from "sonner";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { fetchTrackRadio } from "@/lib/radio";
import { formatDuration } from "@/lib/utils";

interface SimilarTrack {
  path: string;
  track_storage_id?: string;
  track_id?: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  score: number;
}

export function SuggestedTab() {
  const { currentTrack, play, playAll } = usePlayerActions();
  const [tracks, setTracks] = useState<SimilarTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingRadio, setStartingRadio] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "15" });
    setLoading(true);
    setTracks([]);

    if (currentTrack.libraryTrackId != null) {
      params.set("track_id", String(currentTrack.libraryTrackId));
    } else if (currentTrack.path) {
      params.set("path", currentTrack.path);
    } else {
      setTracks([]);
      setLoading(false);
      return;
    }

    api<{ tracks: SimilarTrack[] }>(
      `/api/similar-tracks?${params.toString()}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => setTracks(data.tracks || []))
      .catch((error) => {
        if (controller.signal.aborted || (error as Error).name === "AbortError") return;
        setTracks([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id, currentTrack?.libraryTrackId, currentTrack?.path]);

  async function handleStartTrackRadio() {
    if (!currentTrack) return;
    try {
      setStartingRadio(true);
      const radio = await fetchTrackRadio({
        libraryTrackId: currentTrack.libraryTrackId ?? null,
        storageId: currentTrack.storageId ?? null,
        path: currentTrack.path ?? null,
        title: currentTrack.title,
      });
      if (!radio.tracks.length) {
        toast.info("Track radio is not available yet");
        return;
      }
      playAll(radio.tracks, 0, radio.source);
    } catch {
      toast.error("Failed to start track radio");
    } finally {
      setStartingRadio(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/20">
        No similar tracks found
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pr-1">
      <div className="mb-3 px-1">
        <button
          onClick={handleStartTrackRadio}
          disabled={startingRadio || (!currentTrack?.libraryTrackId && !currentTrack?.storageId && !currentTrack?.path)}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {startingRadio ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
          Start track radio
        </button>
      </div>
      {tracks.map((track, index) => (
        <button
          key={`${track.path}-${index}`}
          onClick={() =>
            play(
              {
                id: track.track_storage_id || track.path,
                storageId: track.track_storage_id,
                path: track.path,
                title: track.title,
                artist: track.artist,
                album: track.album,
                libraryTrackId: track.track_id,
              },
              { type: "radio", name: `Similar to ${currentTrack?.title}` },
            )
          }
          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
        >
          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-white/20">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-white/80">{track.title}</p>
            <p className="truncate text-[10px] text-white/40">
              {track.artist} — {track.album}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] tabular-nums text-white/40">{formatDuration(track.duration)}</span>
            <div className="h-1 w-12 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{ width: `${Math.min(track.score * 100, 100)}%` }}
              />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
