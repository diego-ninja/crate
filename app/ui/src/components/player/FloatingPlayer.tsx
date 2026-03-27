import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useShaderVisualizer } from "./useShaderVisualizer";
import { PRESET_LABELS, type PresetName } from "./ShaderEngine";
import { useDraggable } from "./useDraggable";
import { QueueList } from "./QueueList";
import { api } from "@/lib/api";
import { cn, encPath, formatDuration } from "@/lib/utils";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  X, ChevronLeft, ChevronRight, Music, ListMusic, Mic2,
  Save, Download,
} from "lucide-react";
import { toast } from "sonner";

const SHADER_PRESET_KEY = "shader-preset";

interface TrackMeta { bpm?: number; energy?: number; audio_key?: string; audio_scale?: string; album?: string }

interface FloatingPlayerProps {
  open: boolean;
  onClose: () => void;
  onOpenLyrics: () => void;
}

export function FloatingPlayer({ open, onClose, onOpenLyrics }: FloatingPlayerProps) {
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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);

  const [trackMeta, setTrackMeta] = useState<TrackMeta | null>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "lyrics">("queue");

  // Fetch track metadata
  useEffect(() => {
    if (!currentTrack) return;
    api<TrackMeta>(`/api/track-info/${currentTrack.id}`)
      .then(setTrackMeta)
      .catch(() => setTrackMeta(null));
  }, [currentTrack?.id]);

  // Shader visualizer
  const audioMeta = trackMeta ? { bpm: trackMeta.bpm, energy: trackMeta.energy } : null;
  const { nextPreset, prevPreset, getPreset } = useShaderVisualizer(canvasRef, frequencies, audioMeta, open);

  const [presetLabel, setPresetLabel] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(SHADER_PRESET_KEY);
      if (saved && saved in PRESET_LABELS) return PRESET_LABELS[saved as PresetName];
    } catch { /* ignore */ }
    return PRESET_LABELS.nebula;
  });

  function cyclePresetForward() {
    const name = nextPreset();
    if (name) {
      setPresetLabel(PRESET_LABELS[name]);
      try { localStorage.setItem(SHADER_PRESET_KEY, name); } catch { /* ignore */ }
    }
  }

  function cyclePresetBack() {
    const name = prevPreset();
    if (name) {
      setPresetLabel(PRESET_LABELS[name]);
      try { localStorage.setItem(SHADER_PRESET_KEY, name); } catch { /* ignore */ }
    }
  }

  // Load saved preset on mount
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem(SHADER_PRESET_KEY) as PresetName | null;
      if (saved && saved in PRESET_LABELS) {
        // The useShaderVisualizer loads 'nebula' by default, so we cycle to saved
        // We'll need to set it after engine is ready — small delay
        const timer = setTimeout(() => {
          const current = getPreset();
          if (current !== saved) {
            // Cycle forward until we reach it (max 5 presets)
            for (let i = 0; i < 5; i++) {
              const n = nextPreset();
              if (n === saved) {
                setPresetLabel(PRESET_LABELS[saved]);
                break;
              }
            }
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    } catch { /* ignore */ }
  }, [open]);

  async function saveAsPlaylist() {
    if (queue.length === 0) return;
    const name = `Queue — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    try {
      await api("/api/playlists", "POST", { name, track_ids: queue.map((t) => t.id) });
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
  const textShadow = "0 1px 4px rgba(0,0,0,0.8)";

  return (
    <div
      className="fixed z-[100] w-[420px] rounded-2xl overflow-hidden shadow-2xl shadow-black/60 border border-white/10"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* WebGL canvas background */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* Overlay content */}
      <div className="relative z-10 flex flex-col">
        {/* Header — drag handle */}
        <div
          className="flex items-center justify-between px-4 py-3 cursor-grab active:cursor-grabbing select-none bg-black/20 backdrop-blur-sm"
          onMouseDown={onDragStart}
        >
          <div className="flex items-center gap-2">
            <button onClick={cyclePresetBack} className="p-0.5 text-white/50 hover:text-white/80">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[10px] font-medium text-white/60 uppercase tracking-wider" style={{ textShadow }}>
              {presetLabel}
            </span>
            <button onClick={cyclePresetForward} className="p-0.5 text-white/50 hover:text-white/80">
              <ChevronRight size={14} />
            </button>
          </div>
          <button onClick={onClose} className="p-1 text-white/50 hover:text-white/80 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Cover + Track info */}
        <div className="flex flex-col items-center px-6 pt-4 pb-2">
          <div className="w-36 h-36 rounded-xl overflow-hidden ring-2 ring-white/10 shadow-2xl shadow-black/50 mb-4 flex-shrink-0">
            {currentTrack.albumCover ? (
              <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-white/5 flex items-center justify-center">
                <Music size={40} className="text-white/20" />
              </div>
            )}
          </div>
          <div className="text-center w-full">
            <div className="text-base font-bold text-white truncate" style={{ textShadow }}>
              {currentTrack.title}
            </div>
            <button
              onClick={() => navigate(`/artist/${encPath(currentTrack.artist)}`)}
              className="text-sm text-white/70 hover:text-white transition-colors truncate block w-full"
              style={{ textShadow }}
            >
              {currentTrack.artist}
            </button>
            {albumName && (
              <button
                onClick={() => navigate(`/album/${encPath(currentTrack.artist)}/${encPath(albumName)}`)}
                className="text-xs text-white/40 hover:text-white/60 transition-colors truncate block w-full"
                style={{ textShadow }}
              >
                {albumName}
              </button>
            )}
          </div>

          {/* Track metadata badges */}
          {trackMeta && (trackMeta.bpm || trackMeta.audio_key || trackMeta.energy != null) && (
            <div className="flex gap-2 mt-2">
              {trackMeta.bpm ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/10">{Math.round(trackMeta.bpm)} BPM</span> : null}
              {trackMeta.audio_key ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/10">{trackMeta.audio_key} {trackMeta.audio_scale || ""}</span> : null}
              {trackMeta.energy != null ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/10">E {Math.round(trackMeta.energy * 100)}</span> : null}
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="px-6 py-1">
          <div className="flex items-center gap-2 text-[10px] text-white/50 font-mono">
            <span className="w-8 text-right">{formatDuration(Math.floor(currentTime))}</span>
            <div
              className="flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer group relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                seek(pct * duration);
              }}
            >
              <div className="h-full bg-white/70 rounded-full transition-all" style={{ width: `${progress}%` }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
            <span className="w-8">{formatDuration(Math.floor(duration))}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-2 py-3">
          <button onClick={toggleShuffle} className={cn("p-1.5 rounded transition-colors", shuffle ? "text-primary" : "text-white/40 hover:text-white/70")}>
            <Shuffle size={14} />
          </button>
          <button onClick={prev} className="p-1.5 text-white/70 hover:text-white transition-colors">
            <SkipBack size={18} />
          </button>
          <button
            onClick={isPlaying ? pause : resume}
            className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center hover:bg-white transition-colors"
          >
            {isPlaying ? <Pause size={18} className="text-black" /> : <Play size={18} className="text-black ml-0.5" />}
          </button>
          <button onClick={next} className="p-1.5 text-white/70 hover:text-white transition-colors">
            <SkipForward size={18} />
          </button>
          <button onClick={cycleRepeat} className={cn("p-1.5 rounded transition-colors", repeat !== "off" ? "text-primary" : "text-white/40 hover:text-white/70")}>
            {repeat === "one" ? <Repeat1 size={14} /> : <Repeat size={14} />}
          </button>
        </div>

        {/* Actions row */}
        <div className="flex items-center justify-center gap-3 pb-2">
          <button onClick={onOpenLyrics} className="p-1 text-white/40 hover:text-white/70 transition-colors" title="Lyrics">
            <Mic2 size={13} />
          </button>
          <button onClick={saveAsPlaylist} className="p-1 text-white/40 hover:text-white/70 transition-colors" title="Save queue as playlist">
            <Save size={13} />
          </button>
          <button onClick={exportM3U} className="p-1 text-white/40 hover:text-white/70 transition-colors" title="Export .m3u">
            <Download size={13} />
          </button>
          {playbackRate !== 1 && (
            <span className="text-[10px] text-primary font-mono">{playbackRate}x</span>
          )}
        </div>

        {/* Tabs: Queue | Lyrics */}
        <div className="flex border-t border-white/10 bg-black/30 backdrop-blur-sm">
          <button
            className={cn("flex-1 py-2 text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5",
              activeTab === "queue" ? "text-primary border-b-2 border-primary" : "text-white/40")}
            onClick={() => setActiveTab("queue")}
          >
            <ListMusic size={12} /> Queue ({queue.length})
          </button>
          <button
            className={cn("flex-1 py-2 text-xs font-medium text-center transition-colors flex items-center justify-center gap-1.5",
              activeTab === "lyrics" ? "text-primary border-b-2 border-primary" : "text-white/40")}
            onClick={() => { setActiveTab("lyrics"); onOpenLyrics(); }}
          >
            <Mic2 size={12} /> Lyrics
          </button>
        </div>

        {/* Tab content */}
        <div className="max-h-[200px] overflow-y-auto bg-black/40 backdrop-blur-sm">
          {activeTab === "queue" && (
            <div className="p-2">
              <QueueList />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
