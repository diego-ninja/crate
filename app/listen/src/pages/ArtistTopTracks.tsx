import { ArrowLeft, Play } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { TrackRow } from "@/components/cards/TrackRow";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { encPath } from "@/lib/utils";

interface ArtistTopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

function toPlayerTracks(tracks: ArtistTopTrack[]): Track[] {
  return tracks.map((track) => ({
    id: track.id,
    title: track.title || "Unknown",
    artist: track.artist,
    album: track.album,
    albumCover: track.artist && track.album
      ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
      : `/api/artist/${encPath(track.artist)}/photo`,
    path: track.id.includes("/") ? track.id : undefined,
    navidromeId: track.id.includes("/") ? undefined : track.id,
  }));
}

export function ArtistTopTracks() {
  const navigate = useNavigate();
  const { name } = useParams<{ name: string }>();
  const decodedName = decodeURIComponent(name || "");
  const { playAll } = usePlayerActions();
  const { data: topTracks, loading } = useApi<ArtistTopTrack[]>(
    decodedName ? `/api/navidrome/artist/${encPath(decodedName)}/top-tracks?count=50` : null,
  );

  function handlePlayAll() {
    const queue = toPlayerTracks(topTracks || []);
    if (!queue.length) {
      toast.info("No top tracks available for this artist yet");
      return;
    }
    playAll(queue, 0, { type: "queue", name: `${decodedName} Top Tracks` });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-16">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/artist/${encPath(decodedName)}`)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-white/70 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{decodedName}</h1>
            <p className="text-sm text-muted-foreground">Top Tracks</p>
          </div>
        </div>

        <button
          className="flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={handlePlayAll}
        >
          <Play size={15} fill="currentColor" />
          Play
        </button>
      </div>

      <div className="rounded-xl border border-white/5 bg-white/[0.02]">
        {(topTracks || []).map((track, index) => (
          <TrackRow
            key={`${track.id}-${index}`}
            track={{
              id: track.id,
              title: track.title,
              artist: track.artist,
              album: track.album,
              duration: track.duration,
              path: track.id.includes("/") ? track.id : undefined,
              navidrome_id: track.id.includes("/") ? undefined : track.id,
            }}
            index={track.track || index + 1}
            showAlbum
            albumCover={track.artist && track.album
              ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}`
              : `/api/artist/${encPath(track.artist)}/photo`}
            showCoverThumb
          />
        ))}
      </div>
    </div>
  );
}
