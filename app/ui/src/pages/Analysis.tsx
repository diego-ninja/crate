import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AudioWaveform, Music, RefreshCw, Loader2 } from "lucide-react";

interface AnalysisStatus {
  total: number;
  analysis_done: number;
  analysis_pending: number;
  analysis_active: number;
  analysis_failed: number;
  bliss_done: number;
  bliss_pending: number;
  bliss_active: number;
  bliss_failed: number;
  last_analyzed: {
    title?: string;
    artist?: string;
    album?: string;
    bpm?: number;
    audio_key?: string;
    energy?: number;
    danceability?: number;
    has_mood?: boolean;
    updated_at?: string;
  };
  last_bliss: {
    title?: string;
    artist?: string;
    album?: string;
    updated_at?: string;
  };
}

function ProgressBar({ done, total, active, label }: { done: number; total: number; active: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span>{done.toLocaleString()} / {total.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-md overflow-hidden">
        <div className="h-full bg-primary rounded-md transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      {active > 0 && <p className="text-xs text-primary mt-1">Analyzing {active} track{active > 1 ? "s" : ""}...</p>}
    </div>
  );
}

function LastTrack({ track, label }: { track: AnalysisStatus["last_analyzed"] | AnalysisStatus["last_bliss"]; label: string }) {
  if (!track?.title) return null;
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <p className="font-medium">{track.title}</p>
      <p className="text-sm text-muted-foreground">{track.artist} — {track.album}</p>
      {"bpm" in track && track.bpm != null && (
        <div className="flex gap-3 mt-2 text-xs">
          {track.bpm != null && <span>BPM {Math.round(track.bpm)}</span>}
          {"audio_key" in track && track.audio_key && <span>Key {track.audio_key}</span>}
          {"energy" in track && track.energy != null && <span>Energy {(track.energy * 100).toFixed(0)}%</span>}
          {"danceability" in track && track.danceability != null && <span>Dance {(track.danceability * 100).toFixed(0)}%</span>}
          {"has_mood" in track && <span>{track.has_mood ? "Mood OK" : "No mood"}</span>}
        </div>
      )}
      {track.updated_at && (
        <p className="text-xs text-muted-foreground mt-1">{new Date(track.updated_at).toLocaleString()}</p>
      )}
    </div>
  );
}

export function Analysis() {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const data = await api<AnalysisStatus>("/api/manage/analysis-status");
      setStatus(data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, []);

  const reanalyzeAll = async (what: string) => {
    const endpoint = what === "bliss" ? "/api/manage/compute-bliss" : "/api/manage/analyze-all";
    await api(endpoint, "POST");
    setTimeout(refresh, 1000);
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!status) return <p className="text-muted-foreground p-6">Could not load analysis status</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AudioWaveform className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold">Background Analysis</h1>
        </div>
        <button onClick={refresh} className="p-2 rounded-md hover:bg-muted transition-colors">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground">
        Two background daemons process tracks independently: one for audio analysis
        (BPM, key, energy, mood, danceability) and one for bliss vectors (song similarity DNA).
        They run continuously and pick up new tracks automatically.
      </p>

      <div className="space-y-4">
        <div className="rounded-md border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-primary" />
              <h2 className="font-medium">Audio Analysis</h2>
            </div>
            <button
              onClick={() => reanalyzeAll("analysis")}
              className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
            >
              Re-analyze all
            </button>
          </div>
          <ProgressBar done={status.analysis_done} total={status.total} active={status.analysis_active} label="Tracks analyzed" />
          {status.analysis_failed > 0 && (
            <p className="text-xs text-destructive">{status.analysis_failed} tracks failed</p>
          )}
        </div>

        <div className="rounded-md border border-border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AudioWaveform className="h-4 w-4 text-primary" />
              <h2 className="font-medium">Bliss Vectors</h2>
            </div>
            <button
              onClick={() => reanalyzeAll("bliss")}
              className="text-xs px-3 py-1 rounded-md border border-border hover:bg-muted transition-colors"
            >
              Recompute all
            </button>
          </div>
          <ProgressBar done={status.bliss_done} total={status.total} active={status.bliss_active} label="Vectors computed" />
          {status.bliss_failed > 0 && (
            <p className="text-xs text-destructive">{status.bliss_failed} tracks failed</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <LastTrack track={status.last_analyzed} label="Last analyzed track" />
        <LastTrack track={status.last_bliss} label="Last bliss computation" />
      </div>
    </div>
  );
}
