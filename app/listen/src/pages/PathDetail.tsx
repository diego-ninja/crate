import { useCallback, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Loader2, MapPin, Play, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";

interface PathEndpoint {
  type: string;
  value: string;
  label: string;
}

interface PathTrack {
  step: number;
  progress: number;
  track_id: number;
  storage_id?: string;
  title: string;
  artist: string;
  album?: string;
  album_id?: number;
  distance: number;
}

interface PathData {
  id: number;
  name: string;
  origin: PathEndpoint;
  destination: PathEndpoint;
  waypoints: PathEndpoint[];
  step_count: number;
  tracks: PathTrack[];
  created_at: string;
}

function mapToPlayerTrack(t: PathTrack): Track {
  return {
    id: t.storage_id || String(t.track_id),
    storageId: t.storage_id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumId: t.album_id,
    albumCover: t.album_id ? albumCoverApiUrl({ albumId: t.album_id }) : undefined,
    libraryTrackId: t.track_id,
  };
}

function mapToTrackRowData(t: PathTrack): TrackRowData {
  return {
    id: t.track_id,
    storage_id: t.storage_id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    album_id: t.album_id,
  };
}

export function PathDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: path, loading, refetch } = useApi<PathData>(`/api/paths/${id}`);
  const { playAll, currentTrack } = usePlayerActions();
  const [regenerating, setRegenerating] = useState(false);

  const playFromStep = useCallback((startIndex: number) => {
    if (!path) return;
    const tracks = path.tracks.map(mapToPlayerTrack);
    playAll(tracks, startIndex, { type: "playlist", name: path.name, id: path.id });
  }, [path, playAll]);

  const regenerate = async () => {
    if (!path || regenerating) return;
    setRegenerating(true);
    try {
      await api(`/api/paths/${path.id}/regenerate`, "POST");
      toast.success("Path regenerated with fresh tracks");
      refetch();
    } catch {
      toast.error("Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  };

  const deletePath = async () => {
    if (!path) return;
    try {
      await api(`/api/paths/${path.id}`, "DELETE");
      toast.success("Path deleted");
      navigate("/paths");
    } catch {
      toast.error("Failed to delete");
    }
  };

  if (loading || !path) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-primary" />
      </div>
    );
  }

  const allTrackRows: TrackRowData[] = path.tracks.map(mapToTrackRowData);

  return (
    <div className="animate-page-in px-4 py-6 sm:px-6">
      {/* Back */}
      <button
        onClick={() => navigate("/paths")}
        className="mb-4 flex items-center gap-1.5 text-sm text-white/50 transition hover:text-white"
      >
        <ArrowLeft size={14} /> Paths
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">{path.name}</h1>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/40">
              <MapPin size={11} className="text-primary/60" />
              <span className="font-medium text-white/60">{path.origin.label}</span>
              <span className="text-white/15">→</span>
              <span className="font-medium text-white/60">{path.destination.label}</span>
            </div>
            <div className="mt-1 text-[11px] text-white/25">
              {path.tracks.length} tracks · {new Date(path.created_at).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => playFromStep(0)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_16px_rgba(6,182,212,0.4)] transition hover:bg-primary/90"
            >
              <Play size={18} className="ml-0.5 fill-current" />
            </button>
          </div>
        </div>
      </div>

      {/* Path route visualization */}
      <div className="mb-6">
        <div className="relative mx-2 py-4">
          {/* Base line */}
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/8" />
          {/* Progress line — full width if not playing, or to current track */}
          <div
            className="absolute left-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
            style={{
              width: "100%",
              background: "linear-gradient(90deg, rgba(6,182,212,0.1), rgba(6,182,212,0.4), rgba(6,182,212,0.1))",
            }}
          />
          {/* Nodes */}
          <div className="relative flex items-center justify-between">
            {path.tracks.map((t, i) => {
              const isPlaying = currentTrack?.libraryTrackId === t.track_id;
              const showLabel = i === 0 || i === path.tracks.length - 1;
              return (
                <button
                  key={t.step}
                  onClick={() => playFromStep(i)}
                  title={`${t.title} — ${t.artist}`}
                  className="group relative flex h-4 w-4 flex-shrink-0 items-center justify-center"
                >
                  <div className={`rounded-full transition-all duration-300 ${
                    isPlaying
                      ? "h-3.5 w-3.5 bg-primary shadow-[0_0_16px_rgba(6,182,212,0.7)]"
                      : "h-1.5 w-1.5 bg-primary/50 group-hover:h-2.5 group-hover:w-2.5 group-hover:bg-primary/80"
                  }`} />
                  {showLabel && (
                    <span className="pointer-events-none absolute top-full mt-1.5 whitespace-nowrap text-[8px] text-white/30">
                      {i === 0 ? path.origin.label : path.destination.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={regenerate}
          disabled={regenerating}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/60 transition hover:border-white/20 hover:text-white disabled:opacity-30"
        >
          {regenerating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
          Regenerate
        </button>
        <button
          onClick={deletePath}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/60 transition hover:border-red-400/30 hover:text-red-300"
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>

      {/* Track list */}
      <div className="space-y-0.5">
        {path.tracks.map((t, i) => (
          <div key={t.step} className="relative">
            {/* Step indicator */}
            <div className="absolute -left-1 top-1/2 flex -translate-y-1/2 flex-col items-center">
              <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
            </div>
            <div className="pl-4">
              <TrackRow
                track={mapToTrackRowData(t)}
                index={i}
                showArtist
                showAlbum
                queueTracks={allTrackRows}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
