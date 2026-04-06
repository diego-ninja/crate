import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { useMusicVisualizer } from "./visualizer/useMusicVisualizer";
import { useDraggable } from "./useDraggable";
import { QueueList } from "./QueueList";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { cn, formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  X, Music, ListMusic, Mic2, Save, Download, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { StarRating } from "@/components/ui/star-rating";

interface TrackMeta { bpm?: number; energy?: number; audio_key?: string; audio_scale?: string; album?: string; rating?: number }

interface FloatingPlayerProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingPlayer({ open, onClose }: FloatingPlayerProps) {
  const {
    currentTrack, isPlaying, currentTime, duration, queue,
    pause, resume, next, prev, seek, shuffle, repeat,
    toggleShuffle, cycleRepeat, audioElement, playbackRate,
  } = usePlayer();
  const navigate = useNavigate();
  const { pos, onDragStart } = useDraggable("floating-player", {
    x: Math.max(0, window.innerWidth / 2 - 220),
    y: 80,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useMusicVisualizer(canvasRef, audioElement, open && isPlaying);
  const [trackMeta, setTrackMeta] = useState<TrackMeta | null>(null);
  const [currentRating, setCurrentRating] = useState(0);
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "lyrics">("queue");

  // Lyrics state
  const [lyrics, setLyrics] = useState<{ synced: { time: number; text: string }[] | null; plain: string | null }>({ synced: null, plain: null });
  const [lyricsLoading, setLyricsLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    api<TrackMeta>(currentTrack.libraryTrackId != null ? `/api/tracks/${currentTrack.libraryTrackId}/info` : `/api/track-info/${currentTrack.id}`)
      .then((m) => { setTrackMeta(m); setCurrentRating(m?.rating ?? 0); })
      .catch(() => { setTrackMeta(null); setCurrentRating(0); });
  }, [currentTrack?.id]);

  function handleRate(rating: number) {
    if (!currentTrack) return;
    setCurrentRating(rating);
    const path = currentTrack.id.includes("/") ? currentTrack.id : undefined;
    api("/api/track/rate", "POST", { path, rating }).catch(() => setCurrentRating(0));
  }

  // Fetch lyrics when lyrics tab active
  useEffect(() => {
    if (!currentTrack || activeTab !== "lyrics") return;
    setLyricsLoading(true);
    const artist = encodeURIComponent(currentTrack.artist);
    const title = encodeURIComponent(currentTrack.title);
    api<{ syncedLyrics: string | null; plainLyrics: string | null }>(`/api/lyrics?artist=${artist}&title=${title}`)
      .then(d => {
        let synced: { time: number; text: string }[] | null = null;
        if (d.syncedLyrics) {
          synced = [];
          for (const line of d.syncedLyrics.split("\n")) {
            const m = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.*)/);
            if (m) synced.push({ time: parseInt(m[1]!) * 60 + parseInt(m[2]!) + parseInt(m[3]!) / 100, text: m[4]! });
          }
        }
        setLyrics({ synced, plain: d.plainLyrics || null });
      })
      .catch(() => setLyrics({ synced: null, plain: null }))
      .finally(() => setLyricsLoading(false));
  }, [currentTrack?.id, activeTab]);

  async function saveAsPlaylist() {
    if (queue.length === 0) return;
    const name = `Queue — ${new Date().toLocaleDateString()}`;
    try {
      await api("/api/playlists", "POST", { name, track_ids: queue.map(t => t.id) });
      toast.success(`Saved as "${name}"`);
    } catch { toast.error("Failed to save playlist"); }
  }

  function exportM3U() {
    if (queue.length === 0) return;
    const lines = ["#EXTM3U"];
    for (const track of queue) {
      lines.push(`#EXTINF:-1,${track.artist} - ${track.title}`);
      const url = track.id.includes("/")
        ? `${window.location.origin}/api/stream/${encodeURIComponent(track.id).replace(/%2F/g, "/")}`
        : `${window.location.origin}/api/navidrome/stream/${track.id}`;
      lines.push(url);
    }
    const blob = new Blob([lines.join("\n")], { type: "audio/x-mpegurl" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `crate-queue-${new Date().toISOString().slice(0, 10)}.m3u`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Queue exported as .m3u");
  }

  if (!currentTrack || !open) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const albumName = currentTrack.album || trackMeta?.album || "";

  // Generate pseudo-waveform bars from track ID (deterministic, looks like SoundCloud)
  const waveformBars = useMemo(() => {
    const id = currentTrack?.id || "default";
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    const bars: number[] = [];
    for (let i = 0; i < 80; i++) {
      hash = ((hash << 5) - hash + i * 7) | 0;
      const base = 25 + Math.abs(hash % 50);
      // Create a natural waveform shape: louder in the middle, quieter at edges
      const pos = i / 80;
      const envelope = Math.sin(pos * Math.PI) * 0.4 + 0.6;
      bars.push(Math.min(100, base * envelope + Math.abs((hash >> 3) % 20)));
    }
    return bars;
  }, [currentTrack?.id]);

  // Find active lyric line
  const activeLyricIdx = lyrics.synced
    ? lyrics.synced.reduce((best, line, i) => line.time <= currentTime ? i : best, 0)
    : -1;

  return (
    <div
      className="fixed z-[100] w-[440px] rounded-2xl overflow-hidden shadow-2xl shadow-black/40 border border-border bg-card"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-grab active:cursor-grabbing select-none border-b border-border"
        onMouseDown={onDragStart}
      >
        <span className="text-xs font-medium text-muted-foreground">Now Playing</span>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* WebGL Visualizer */}
      <div className="h-[250px] relative bg-card overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full" />
        {/* Settings toggle */}
        <button
          onClick={() => setShowVizSettings(s => !s)}
          className={cn(
            "absolute top-2 right-2 p-1.5 rounded-md transition-colors z-10",
            showVizSettings ? "bg-white/20 text-white" : "text-white/30 hover:text-white/60"
          )}
        >
          <Settings2 size={14} />
        </button>
        {/* Settings panel */}
        {showVizSettings && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm p-3 z-10 space-y-2">
            {[
              { label: "Separation", key: "separation" as const, min: 0, max: 1, step: 0.01 },
              { label: "Glow", key: "glow" as const, min: 0, max: 10, step: 0.1 },
              { label: "Scale", key: "scale" as const, min: 0, max: 5, step: 0.1 },
              { label: "Persistence", key: "persistence" as const, min: 0, max: 1, step: 0.01 },
              { label: "Octaves", key: "octaves" as const, min: 0, max: 5, step: 1 },
            ].map(({ label, key, min, max, step }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[9px] text-white/50 w-16 text-right">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={vizRef.current?.[key] ?? (key === "glow" ? 4.5 : key === "octaves" ? 1 : key === "scale" ? 1 : 0)}
                  onChange={e => {
                    if (vizRef.current) vizRef.current[key] = Number(e.target.value);
                  }}
                  className="flex-1 h-1 accent-primary"
                />
                <span className="text-[9px] text-white/40 w-6 font-mono">
                  {vizRef.current?.[key]?.toFixed(key === "octaves" ? 0 : 1) ?? ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cover + Track info */}
      <div className="flex items-center gap-4 px-4 py-3">
        <div className="w-20 h-20 rounded-xl overflow-hidden ring-1 ring-border shadow-lg flex-shrink-0">
          {currentTrack.albumCover ? (
            <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-secondary flex items-center justify-center">
              <Music size={24} className="text-muted-foreground/30" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{currentTrack.title}</div>
          <button
            onClick={() => {
              if (currentTrack.artistId != null) {
                navigate(
                  artistPagePath({
                    artistId: currentTrack.artistId,
                    artistSlug: currentTrack.artistSlug,
                    artistName: currentTrack.artist,
                  }),
                );
              }
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate block"
          >
            {currentTrack.artist}
          </button>
          {albumName && (
            <button
              onClick={() => {
                if (currentTrack.albumId != null) {
                  navigate(
                    albumPagePath({
                      albumId: currentTrack.albumId,
                      albumSlug: currentTrack.albumSlug,
                      artistName: currentTrack.artist,
                      albumName,
                    }),
                  );
                }
              }}
              className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors truncate block"
            >
              {albumName}
            </button>
          )}
          <div className="mt-1">
            <StarRating value={currentRating} onChange={handleRate} size={12} />
          </div>
          {trackMeta && (trackMeta.bpm || trackMeta.audio_key) && (
            <div className="flex gap-1.5 mt-1">
              {trackMeta.bpm ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{Math.round(trackMeta.bpm)} BPM</span> : null}
              {trackMeta.audio_key ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{trackMeta.audio_key}{trackMeta.audio_scale ? ` ${trackMeta.audio_scale}` : ""}</span> : null}
            </div>
          )}
        </div>
      </div>

      {/* SoundCloud-style waveform progress */}
      <div className="px-4 pb-1">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
          <span className="w-8 text-right">{formatDuration(Math.floor(currentTime))}</span>
          <div
            className="flex-1 h-8 cursor-pointer relative flex items-end gap-[1.5px]"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
            }}
          >
            {waveformBars.map((h, i) => {
              const barProgress = (i / waveformBars.length) * 100;
              const filled = barProgress < progress;
              return (
                <div key={i} className="flex-1 rounded-sm transition-colors duration-75"
                  style={{
                    height: `${h}%`,
                    backgroundColor: filled ? "var(--color-primary)" : "var(--color-border)",
                    opacity: filled ? 0.9 : 0.4,
                  }}
                />
              );
            })}
          </div>
          <span className="w-8">{formatDuration(Math.floor(duration))}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 py-2">
        <button onClick={toggleShuffle} className={cn("p-1.5 rounded transition-colors", shuffle ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
          <Shuffle size={14} />
        </button>
        <button onClick={prev} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <SkipBack size={18} />
        </button>
        <button
          onClick={isPlaying ? pause : resume}
          className="w-10 h-10 rounded-full bg-primary flex items-center justify-center hover:bg-primary/90 transition-colors"
        >
          {isPlaying ? <Pause size={16} className="text-primary-foreground" /> : <Play size={16} className="text-primary-foreground ml-0.5" />}
        </button>
        <button onClick={next} className="p-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <SkipForward size={18} />
        </button>
        <button onClick={cycleRepeat} className={cn("p-1.5 rounded transition-colors", repeat !== "off" ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
          {repeat === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-center gap-3 pb-2">
        <button onClick={saveAsPlaylist} className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Save as playlist">
          <Save size={12} />
        </button>
        <button onClick={exportM3U} className="p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors" title="Export .m3u">
          <Download size={12} />
        </button>
        {playbackRate !== 1 && <span className="text-[10px] text-primary font-mono">{playbackRate}x</span>}
      </div>

      {/* Tabs */}
      <div className="flex border-t border-border">
        <button
          className={cn("flex-1 py-2 text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5",
            activeTab === "queue" ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}
          onClick={() => setActiveTab("queue")}
        >
          <ListMusic size={12} /> Queue ({queue.length})
        </button>
        <button
          className={cn("flex-1 py-2 text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5",
            activeTab === "lyrics" ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}
          onClick={() => setActiveTab("lyrics")}
        >
          <Mic2 size={12} /> Lyrics
        </button>
      </div>

      {/* Tab content */}
      <div className="max-h-[220px] overflow-y-auto">
        {activeTab === "queue" && (
          <div className="p-2">
            <QueueList />
          </div>
        )}
        {activeTab === "lyrics" && (
          <div className="p-4 lyrics-mask">
            {lyricsLoading && <div className="text-xs text-muted-foreground text-center py-8">Loading lyrics...</div>}
            {!lyricsLoading && !lyrics.synced && !lyrics.plain && (
              <div className="text-xs text-muted-foreground text-center py-8">No lyrics found</div>
            )}
            {!lyricsLoading && lyrics.synced && (
              <div className="space-y-1 text-center">
                {lyrics.synced.map((line, i) => (
                  <div
                    key={i}
                    className={cn(
                      "text-xs py-0.5 cursor-pointer transition-all duration-200",
                      i === activeLyricIdx
                        ? "text-primary font-semibold scale-[1.03]"
                        : Math.abs(i - activeLyricIdx) <= 2
                          ? "text-muted-foreground"
                          : "text-muted-foreground/40"
                    )}
                    onClick={() => seek(line.time)}
                  >
                    {line.text || "..."}
                  </div>
                ))}
              </div>
            )}
            {!lyricsLoading && !lyrics.synced && lyrics.plain && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {lyrics.plain}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
