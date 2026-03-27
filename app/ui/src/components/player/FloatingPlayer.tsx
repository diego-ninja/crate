import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useDraggable } from "./useDraggable";
import { QueueList } from "./QueueList";
import { api } from "@/lib/api";
import { cn, encPath, formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  X, Music, ListMusic, Mic2, Save, Download,
} from "lucide-react";
import { toast } from "sonner";

interface TrackMeta { bpm?: number; energy?: number; audio_key?: string; audio_scale?: string; album?: string }

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
    x: Math.max(0, window.innerWidth / 2 - 210),
    y: 80,
  });
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);
  const [trackMeta, setTrackMeta] = useState<TrackMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "lyrics">("queue");

  // Lyrics state
  const [lyrics, setLyrics] = useState<{ synced: { time: number; text: string }[] | null; plain: string | null }>({ synced: null, plain: null });
  const [lyricsLoading, setLyricsLoading] = useState(false);

  useEffect(() => {
    if (!currentTrack) return;
    api<TrackMeta>(`/api/track-info/${currentTrack.id}`)
      .then(setTrackMeta)
      .catch(() => setTrackMeta(null));
  }, [currentTrack?.id]);

  // Fetch lyrics when lyrics tab active
  useEffect(() => {
    if (!currentTrack || activeTab !== "lyrics") return;
    setLyricsLoading(true);
    const artist = encodeURIComponent(currentTrack.artist);
    const title = encodeURIComponent(currentTrack.title);
    fetch(`https://lrclib.net/api/get?artist_name=${artist}&track_name=${title}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setLyrics({ synced: null, plain: null }); return; }
        let synced: { time: number; text: string }[] | null = null;
        if (d.syncedLyrics) {
          synced = [];
          for (const line of d.syncedLyrics.split("\n")) {
            const m = line.match(/\[(\d+):(\d+)\.(\d+)\]\s*(.*)/);
            if (m) synced.push({ time: parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / 100, text: m[4] });
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

  // Find active lyric line
  const activeLyricIdx = lyrics.synced
    ? lyrics.synced.reduce((best, line, i) => line.time <= currentTime ? i : best, 0)
    : -1;

  return (
    <div
      className="fixed z-[100] w-[400px] rounded-2xl overflow-hidden shadow-2xl shadow-black/40 border border-border bg-card"
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

      {/* Visualizer bars */}
      <div className="h-12 flex items-end gap-[2px] px-4 py-1 bg-card">
        {frequencies.slice(0, 48).map((f, i) => (
          <div key={i} className="flex-1 bg-primary/80 rounded-t-sm transition-all duration-75"
            style={{ height: `${Math.max(2, f * 100)}%` }} />
        ))}
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
            onClick={() => navigate(`/artist/${encPath(currentTrack.artist)}`)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate block"
          >
            {currentTrack.artist}
          </button>
          {albumName && (
            <button
              onClick={() => navigate(`/album/${encPath(currentTrack.artist)}/${encPath(albumName)}`)}
              className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors truncate block"
            >
              {albumName}
            </button>
          )}
          {trackMeta && (trackMeta.bpm || trackMeta.audio_key) && (
            <div className="flex gap-1.5 mt-1">
              {trackMeta.bpm ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{Math.round(trackMeta.bpm)} BPM</span> : null}
              {trackMeta.audio_key ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{trackMeta.audio_key}{trackMeta.audio_scale ? ` ${trackMeta.audio_scale}` : ""}</span> : null}
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-1">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
          <span className="w-8 text-right">{formatDuration(Math.floor(currentTime))}</span>
          <div
            className="flex-1 h-1.5 bg-border rounded-full cursor-pointer group relative"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
            }}
          >
            <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%` }} />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow"
              style={{ left: `calc(${progress}% - 6px)` }}
            />
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
