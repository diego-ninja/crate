import { useMemo } from "react";
import { useParams } from "react-router";
import { Play, Shuffle, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { TrackRow } from "@/components/cards/TrackRow";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";

interface PlaylistTrack {
  id: number;
  playlist_id: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
  added_at: string;
}

interface PlaylistData {
  id: number;
  name: string;
  description?: string;
  user_id: number;
  is_smart: boolean;
  smart_rules?: unknown;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  tracks: PlaylistTrack[];
}

function playlistGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 50%, 30%), hsl(${hue2}, 60%, 20%))`;
}

function fmtTotalDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} hr ${m} min`;
  return `${m} min`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function Playlist() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, refetch } = useApi<PlaylistData>(
    id ? `/api/playlists/${id}` : null,
  );
  const { playAll } = usePlayerActions();

  const playerTracks = useMemo(() => {
    if (!data?.tracks?.length) return [];
    return data.tracks.map(
      (t): Track => ({
        id: t.track_path,
        title: t.title || "Unknown",
        artist: t.artist || "",
        album: t.album,
        albumCover:
          t.artist && t.album
            ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}`
            : undefined,
      }),
    );
  }, [data]);

  function handlePlay() {
    if (playerTracks.length === 0) return;
    playAll(playerTracks, 0);
  }

  function handleShuffle() {
    if (playerTracks.length === 0) return;
    playAll(shuffleArray(playerTracks), 0);
  }

  async function handleRegenerate() {
    if (!id) return;
    try {
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success("Playlist regenerated");
      refetch();
    } catch {
      toast.error("Failed to regenerate playlist");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Playlist not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with gradient */}
      <div
        className="rounded-xl p-6"
        style={{ background: playlistGradient(data.name) }}
      >
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold text-foreground">{data.name}</h1>
          {data.is_smart && (
            <span className="inline-flex items-center rounded-md border border-primary/30 text-primary text-[10px] px-1.5 py-0 font-medium">
              <Sparkles size={10} className="mr-0.5" />
              Smart
            </span>
          )}
        </div>
        {data.description && (
          <p className="text-sm text-white/70 mb-2">{data.description}</p>
        )}
        <div className="text-xs text-white/50">
          {data.track_count} track{data.track_count !== 1 ? "s" : ""}
          {data.total_duration > 0 &&
            ` · ${fmtTotalDuration(data.total_duration)}`}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handlePlay}
            disabled={playerTracks.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Play size={16} fill="currentColor" />
            Play
          </button>
          <button
            onClick={handleShuffle}
            disabled={playerTracks.length === 0}
            className="flex items-center gap-2 rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <Shuffle size={16} />
            Shuffle
          </button>
          {data.is_smart && (
            <button
              onClick={handleRegenerate}
              className="flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
            >
              <RefreshCw size={16} />
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Track list */}
      {data.tracks.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">
            This playlist has no tracks yet
          </p>
        </div>
      ) : (
        <div>
          {data.tracks.map((t, i) => (
            <TrackRow
              key={`${t.track_path}-${t.position}`}
              track={{
                title: t.title,
                artist: t.artist,
                album: t.album,
                duration: t.duration,
                path: t.track_path,
              }}
              index={i + 1}
              showArtist
              showAlbum
            />
          ))}
        </div>
      )}
    </div>
  );
}
