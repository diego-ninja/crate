import { useState, useRef, useCallback, useEffect, forwardRef } from "react";
import { useNavigate } from "react-router";
import { usePlayer } from "@/contexts/PlayerContext";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X,
  Shuffle, Repeat, Repeat1, PanelRightOpen, PanelRightClose,
  Music, Timer, Gauge, Save, Trash2,
} from "lucide-react";
import { formatDuration, encPath } from "@/lib/utils";
import { toast } from "sonner";

const VIZ_KEY = "player-viz";
const PANEL_KEY = "player-panel";

export type VizMode = "bars" | "wave" | "radial" | "glow";
export const VIZ_MODES: VizMode[] = ["bars", "wave", "radial", "glow"];

function getStoredViz(): VizMode {
  try { const v = localStorage.getItem(VIZ_KEY) as VizMode; if (VIZ_MODES.includes(v)) return v; } catch {}
  return "bars";
}
function getStoredPanel(): boolean {
  try { return localStorage.getItem(PANEL_KEY) === "1"; } catch { return false; }
}

// ── Cover Art ────────────────────────────────────────────────────

function CoverArt({ src, size, className, onClick }: { src?: string; size: number; className?: string; onClick?: () => void }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className={`bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center ${onClick ? "cursor-pointer" : ""} ${className}`}
        style={{ width: size, height: size }} onClick={onClick}>
        <Music size={size * 0.35} className="text-primary/50" />
      </div>
    );
  }
  return (
    <img src={src} alt="" className={`object-cover bg-secondary ${onClick ? "cursor-pointer" : ""} ${className}`}
      style={{ width: size, height: size }} onError={() => setError(true)} onClick={onClick} />
  );
}

// ── Visualizers ──────────────────────────────────────────────────

export function BarVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  return (
    <div className={`flex items-end overflow-hidden pointer-events-none ${className}`}>
      {frequencies.map((f, i) => (
        <div key={i} className="flex-1 bg-primary mx-px rounded-t-sm transition-[height] duration-75" style={{ height: `${f * 100}%` }} />
      ))}
    </div>
  );
}

export function WaveVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  const len = frequencies.length, h = 100, w = 100;
  const top: string[] = [], bot: string[] = [];
  for (let i = 0; i < len; i++) {
    const x = (i / (len - 1)) * w;
    top.push(`${x},${h / 2 - frequencies[i]! * 40}`);
    bot.push(`${x},${h / 2 + frequencies[i]! * 25}`);
  }
  return (
    <div className={`overflow-hidden pointer-events-none ${className}`}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full">
        <polyline points={top.join(" ")} fill="none" stroke="currentColor" strokeWidth="0.8" className="text-primary" />
        <polyline points={bot.join(" ")} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-primary/50" />
      </svg>
    </div>
  );
}

export function RadialVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  const cx = 50, cy = 50, baseR = 15, maxR = 45, len = frequencies.length;
  const points: string[] = [];
  for (let i = 0; i < len; i++) {
    const angle = (i / len) * Math.PI * 2 - Math.PI / 2;
    const r = baseR + frequencies[i]! * (maxR - baseR);
    points.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
  }
  return (
    <div className={`overflow-hidden pointer-events-none ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        <polygon points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1" className="text-primary" strokeLinejoin="round" />
        <polygon points={points.join(" ")} fill="currentColor" className="text-primary" opacity="0.3" />
        <circle cx={cx} cy={cy} r={baseR} fill="none" stroke="currentColor" strokeWidth="0.3" className="text-primary/30" />
      </svg>
    </div>
  );
}

export function GlowVisualizer({ frequencies, className }: { frequencies: number[]; className?: string }) {
  if (frequencies.length === 0) return null;
  const step = 4;
  const bars: { x: number; h: number; hue: number }[] = [];
  for (let i = 0; i < frequencies.length; i += step) {
    const avg = frequencies.slice(i, i + step).reduce((a, b) => a + b, 0) / step;
    bars.push({ x: (i / frequencies.length) * 100, h: avg, hue: (i / frequencies.length) * 280 });
  }
  return (
    <div className={`overflow-hidden pointer-events-none ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        <defs>
          {bars.map((b, i) => (
            <linearGradient key={i} id={`glow-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`hsl(${b.hue}, 85%, 65%)`} stopOpacity="1" />
              <stop offset="100%" stopColor={`hsl(${b.hue}, 80%, 45%)`} stopOpacity="0.6" />
            </linearGradient>
          ))}
        </defs>
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={100 - b.h * 100} width={100 / bars.length - 0.5} height={b.h * 100} rx="1" fill={`url(#glow-${i})`} />
        ))}
      </svg>
    </div>
  );
}

const VIZ_MAP: Record<VizMode, typeof BarVisualizer> = {
  bars: BarVisualizer, wave: WaveVisualizer, radial: RadialVisualizer, glow: GlowVisualizer,
};

// ── Track info ───────────────────────────────────────────────────

interface TrackMeta { bpm?: number; audio_key?: string; audio_scale?: string; energy?: number; album?: string }

function useTrackMeta(trackId: string | undefined): TrackMeta | null {
  const [meta, setMeta] = useState<TrackMeta | null>(null);
  useEffect(() => {
    if (!trackId?.includes("/")) { setMeta(null); return; }
    api<TrackMeta>(`/api/track-info/${trackId}`).then(setMeta).catch(() => setMeta(null));
  }, [trackId]);
  return meta;
}

// ── Waveform Progress ────────────────────────────────────────────

function WaveformProgress({ progress, onSeek, frequencies }: { progress: number; onSeek: (pct: number) => void; frequencies: number[] }) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, [onSeek]);

  // Generate pseudo-waveform bars from frequency snapshot or seeded random
  const barCount = 60;
  const bars = frequencies.length > 0
    ? Array.from({ length: barCount }, (_, i) => {
        const fi = Math.floor((i / barCount) * frequencies.length);
        return 0.2 + (frequencies[fi] ?? 0) * 0.8;
      })
    : Array.from({ length: barCount }, (_, i) => 0.3 + Math.sin(i * 0.5) * 0.15 + Math.cos(i * 0.3) * 0.1);

  return (
    <div className="flex-1 h-8 flex items-end gap-px cursor-pointer group relative" onClick={handleClick}>
      {bars.map((h, i) => {
        const pct = (i / barCount) * 100;
        const played = pct < progress;
        return (
          <div key={i} className="flex-1 rounded-t-sm transition-colors duration-150"
            style={{
              height: `${h * 100}%`,
              backgroundColor: played ? "hsl(var(--primary))" : "hsl(var(--secondary))",
              opacity: played ? 0.9 : 0.4,
            }} />
        );
      })}
      {/* Playhead */}
      <div className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-sm shadow-primary/50 transition-[left] duration-100"
        style={{ left: `${progress}%` }} />
    </div>
  );
}

// ── Equalizer animation ──────────────────────────────────────────

function Equalizer({ small }: { small?: boolean }) {
  const h = small ? "h-2" : "h-2.5", w = small ? "w-[2px]" : "w-[2.5px]";
  return (
    <div className={`flex items-end gap-[1.5px] ${h} flex-shrink-0`}>
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "0ms" }} />
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "150ms" }} />
      <span className={`equalizer-bar ${w} bg-primary-foreground rounded-sm`} style={{ animationDelay: "300ms" }} />
    </div>
  );
}

// ── Speed selector ───────────────────────────────────────────────

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function SpeedButton({ rate, onChange }: { rate: number; onChange: (r: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className={`text-[10px] px-1.5 py-0.5 rounded ${rate !== 1 ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
        title="Playback speed">
        <Gauge size={11} className="inline mr-0.5" />{rate}x
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-xl py-1 z-50">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => { onChange(s); setOpen(false); }}
              className={`block w-full px-3 py-1 text-xs text-left hover:bg-accent ${s === rate ? "text-primary" : ""}`}>
              {s}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sleep Timer ──────────────────────────────────────────────────

const SLEEP_OPTIONS = [null, 15, 30, 45, 60, 90];

function SleepButton({ timer, onChange }: { timer: number | null; onChange: (m: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className={`p-1 rounded ${timer ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        title={timer ? `Sleep in ${timer}m` : "Sleep timer"}>
        <Timer size={12} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-xl py-1 z-50">
          {SLEEP_OPTIONS.map((m) => (
            <button key={m ?? "off"} onClick={() => { onChange(m); setOpen(false); }}
              className={`block w-full px-3 py-1 text-xs text-left hover:bg-accent whitespace-nowrap ${m === timer ? "text-primary" : ""}`}>
              {m ? `${m} min` : "Off"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────

export function AudioPlayer() {
  const {
    queue, currentIndex, isPlaying, currentTime, duration, volume,
    shuffle, repeat, playbackRate, sleepTimer,
    pause, resume, next, prev, seek, setVolume,
    clearQueue, toggleShuffle, cycleRepeat, currentTrack, audioElement,
    removeFromQueue, setPlaybackRate, setSleepTimer,
  } = usePlayer();
  const navigate = useNavigate();

  const [panelOpen, setPanelOpen] = useState(getStoredPanel);
  const [vizMode, setVizMode] = useState<VizMode>(getStoredViz);
  const [activeTab, setActiveTab] = useState<"queue" | "lyrics">("queue");
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);
  const trackMeta = useTrackMeta(currentTrack?.id);

  if (!currentTrack) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const Viz = VIZ_MAP[vizMode];
  const albumName = currentTrack.album || trackMeta?.album || "";

  function togglePanel() {
    const next = !panelOpen;
    setPanelOpen(next);
    try { localStorage.setItem(PANEL_KEY, next ? "1" : "0"); } catch {}
  }

  function cycleViz() {
    const idx = VIZ_MODES.indexOf(vizMode);
    const next = VIZ_MODES[(idx + 1) % VIZ_MODES.length]!;
    setVizMode(next);
    try { localStorage.setItem(VIZ_KEY, next); } catch {}
  }

  function navigateToAlbum() {
    if (albumName && currentTrack) {
      navigate(`/album/${encPath(currentTrack.artist)}/${encPath(albumName)}`);
      if (panelOpen) togglePanel();
    }
  }

  async function saveAsPlaylist() {
    if (queue.length === 0) return;
    const name = `Queue — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    try {
      await api("/api/playlists", "POST", {
        name,
        track_ids: queue.map((t) => t.id),
      });
      toast.success(`Saved as "${name}"`);
    } catch {
      toast.error("Failed to save playlist");
    }
  }

  return (
    <>
      {/* ═══ SIDE PANEL ═══ */}
      {panelOpen && (
        <div className="fixed right-0 top-0 bottom-12 w-[360px] z-50 bg-card/98 backdrop-blur-xl border-l border-border shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col overflow-hidden">
          {currentTrack.albumCover && (
            <img src={currentTrack.albumCover} alt=""
              className="absolute inset-0 w-full h-full object-cover opacity-[0.06] blur-3xl scale-125 pointer-events-none" />
          )}

          {/* Cover + info */}
          <div className="relative z-10 p-5 flex flex-col items-center">
            <CoverArt src={currentTrack.albumCover} size={200}
              className="rounded-xl ring-1 ring-white/10 shadow-2xl shadow-black/50 mb-4"
              onClick={navigateToAlbum} />
            <div className="text-center w-full">
              <div className="text-lg font-bold truncate">{currentTrack.title}</div>
              <button onClick={() => { navigate(`/artist/${encPath(currentTrack.artist)}`); togglePanel(); }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors truncate block w-full">
                {currentTrack.artist}
              </button>
              {albumName && (
                <button onClick={navigateToAlbum}
                  className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors truncate block w-full">
                  {albumName}
                </button>
              )}
            </div>

            {/* Metadata */}
            {trackMeta && (trackMeta.bpm || trackMeta.audio_key || trackMeta.energy != null) && (
              <div className="flex gap-2 mt-2">
                {trackMeta.bpm ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">{Math.round(trackMeta.bpm)} BPM</span> : null}
                {trackMeta.audio_key ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">{trackMeta.audio_key} {trackMeta.audio_scale || ""}</span> : null}
                {trackMeta.energy != null ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">⚡ {Math.round(trackMeta.energy * 100)}</span> : null}
              </div>
            )}
          </div>

          {/* Waveform progress */}
          <div className="relative z-10 px-5">
            <WaveformProgress progress={progress} onSeek={(pct) => seek(pct * duration)} frequencies={frequencies} />
            <div className="flex justify-between text-[10px] text-muted-foreground font-mono mt-1">
              <span>{formatDuration(Math.floor(currentTime))}</span>
              <span>{formatDuration(Math.floor(duration))}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="relative z-10 flex items-center justify-center gap-1 py-3">
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${shuffle ? "text-primary" : "text-muted-foreground"}`} onClick={toggleShuffle}>
              <Shuffle size={13} />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prev}><SkipBack size={15} /></Button>
            <Button size="icon" className="h-11 w-11 rounded-full bg-foreground text-background hover:bg-foreground/90" onClick={isPlaying ? pause : resume}>
              {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={next}><SkipForward size={15} /></Button>
            <Button variant="ghost" size="icon" className={`h-7 w-7 ${repeat !== "off" ? "text-primary" : "text-muted-foreground"}`} onClick={cycleRepeat}>
              {repeat === "one" ? <Repeat1 size={13} /> : <Repeat size={13} />}
            </Button>
          </div>

          {/* Visualizer */}
          <button onClick={cycleViz} className="relative z-10 mx-5 h-16 rounded-lg overflow-hidden bg-white/[0.03] border border-white/5" title={`Visualizer: ${vizMode}`}>
            <Viz frequencies={frequencies} className="w-full h-full opacity-60" />
          </button>

          {/* Extra controls: volume, speed, sleep, save */}
          <div className="relative z-10 flex items-center gap-2 px-5 py-2">
            <button onClick={() => setVolume(volume > 0 ? 0 : 0.8)}>
              {volume > 0 ? <Volume2 size={13} className="text-muted-foreground" /> : <VolumeX size={13} className="text-muted-foreground" />}
            </button>
            <VolumeSlider volume={volume} onChange={setVolume} />
            <div className="flex-1" />
            <SpeedButton rate={playbackRate} onChange={setPlaybackRate} />
            <SleepButton timer={sleepTimer} onChange={setSleepTimer} />
            <button onClick={saveAsPlaylist} className="p-1 text-muted-foreground hover:text-foreground" title="Save queue as playlist">
              <Save size={12} />
            </button>
          </div>

          {/* Tabs */}
          <div className="relative z-10 flex border-t border-border mt-1">
            <button className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${activeTab === "queue" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
              onClick={() => setActiveTab("queue")}>
              Queue ({queue.length})
            </button>
            <button className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${activeTab === "lyrics" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
              onClick={() => setActiveTab("lyrics")}>
              Lyrics
            </button>
          </div>

          {/* Tab content */}
          <div className="relative z-10 flex-1 overflow-y-auto">
            {activeTab === "queue" ? (
              <div className="p-2">
                {queue.map((track, i) => (
                  <InlineQueueItem key={`${track.id}-${i}`} track={track} index={i} currentIndex={currentIndex}
                    onRemove={() => removeFromQueue(i)} />
                ))}
              </div>
            ) : (
              <InlineLyrics artist={currentTrack.artist} title={currentTrack.title} currentTime={currentTime} />
            )}
          </div>
        </div>
      )}

      {/* ═══ MINI BAR ═══ */}
      <div className="fixed bottom-0 left-0 right-0 z-50 h-12 bg-card/95 backdrop-blur-md border-t border-border flex items-center gap-3 px-3 animate-in slide-in-from-bottom duration-200">
        <Viz frequencies={frequencies} className="absolute inset-0 opacity-10 pointer-events-none" />

        {/* Cover + info */}
        <div className="flex items-center gap-2 min-w-0 flex-1 relative z-10">
          <div className="relative flex-shrink-0">
            <CoverArt src={currentTrack.albumCover} size={36} className="rounded-md" />
            {isPlaying && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary flex items-center justify-center">
                <Equalizer small />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{currentTrack.title}</div>
            <div className="text-[10px] text-muted-foreground truncate">{currentTrack.artist}{albumName ? ` — ${albumName}` : ""}</div>
          </div>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 flex-1 max-w-[300px] relative z-10">
          <span className="text-[9px] text-muted-foreground font-mono w-8 text-right">{formatDuration(Math.floor(currentTime))}</span>
          <ProgressBar progress={progress} onSeek={(pct) => seek(pct * duration)} />
          <span className="text-[9px] text-muted-foreground font-mono w-8">{formatDuration(Math.floor(duration))}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-0.5 relative z-10">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={prev}><SkipBack size={13} /></Button>
          <Button size="icon" className="h-8 w-8 rounded-full bg-foreground text-background hover:bg-foreground/90" onClick={isPlaying ? pause : resume}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={next}><SkipForward size={13} /></Button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-1 relative z-10">
          <button onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="p-1">
            {volume > 0 ? <Volume2 size={13} className="text-muted-foreground" /> : <VolumeX size={13} className="text-muted-foreground" />}
          </button>
          <VolumeSlider volume={volume} onChange={setVolume} />
          {sleepTimer && <span className="text-[9px] text-primary font-mono">{sleepTimer}m</span>}
          {playbackRate !== 1 && <span className="text-[9px] text-primary font-mono">{playbackRate}x</span>}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={togglePanel} title={panelOpen ? "Close panel" : "Open panel"}>
            {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={clearQueue}><X size={13} /></Button>
        </div>
      </div>
    </>
  );
}

// ── Inline Queue Item ────────────────────────────────────────────

function InlineQueueItem({ track, index, currentIndex, onRemove }: {
  track: { id: string; title: string; artist: string; albumCover?: string };
  index: number; currentIndex: number; onRemove: () => void;
}) {
  const { jumpTo } = usePlayer();
  const isCurrent = index === currentIndex;
  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-secondary group ${isCurrent ? "bg-primary/10" : ""}`}>
      <button onClick={() => jumpTo(index)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
        {track.albumCover ? (
          <img src={track.albumCover} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center flex-shrink-0">
            <Music size={10} className="text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{track.title}</div>
          <div className="text-[9px] text-muted-foreground truncate">{track.artist}</div>
        </div>
      </button>
      {isCurrent && (
        <div className="flex items-end gap-[2px] h-2.5 flex-shrink-0">
          <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "0ms" }} />
          <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "150ms" }} />
          <span className="equalizer-bar w-[2px] bg-primary rounded-sm" style={{ animationDelay: "300ms" }} />
        </div>
      )}
      {!isCurrent && (
        <button onClick={onRemove} className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 transition-opacity flex-shrink-0">
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ── Inline Lyrics ────────────────────────────────────────────────

function InlineLyrics({ artist, title, currentTime }: { artist: string; title: string; currentTime: number }) {
  const [lines, setLines] = useState<{ time: number; text: string }[] | null>(null);
  const [plain, setPlain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true); setLines(null); setPlain(null);
    const enc = (s: string) => encodeURIComponent(s);
    fetch(`https://lrclib.net/api/get?artist_name=${enc(artist)}&track_name=${enc(title)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.syncedLyrics) {
          const parsed: { time: number; text: string }[] = [];
          for (const line of data.syncedLyrics.split("\n")) {
            const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
            if (m) {
              const t = parseInt(m[1]!) * 60 + parseInt(m[2]!) + parseInt(m[3]!.padEnd(3, "0")) / 1000;
              if (m[4]!.trim()) parsed.push({ time: t, text: m[4]!.trim() });
            }
          }
          setLines(parsed.length > 0 ? parsed : null);
        }
        if (data?.plainLyrics && !data?.syncedLyrics) setPlain(data.plainLyrics);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [artist, title]);

  const activeIdx = lines ? lines.reduce((best, l, i) => (l.time <= currentTime ? i : best), 0) : -1;

  useEffect(() => {
    if (activeIdx >= 0 && scrollRef.current) {
      const el = scrollRef.current.children[activeIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIdx]);

  if (loading) return <div className="text-xs text-muted-foreground text-center py-8">Loading lyrics...</div>;
  if (!lines && !plain) return <div className="text-xs text-muted-foreground text-center py-8">No lyrics found</div>;

  if (lines) {
    return (
      <div ref={scrollRef} className="px-4 py-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className={`text-sm transition-all duration-300 ${i === activeIdx ? "text-primary font-semibold scale-[1.02]" : "text-muted-foreground/60"}`}>{l.text}</div>
        ))}
      </div>
    );
  }
  return <div className="px-4 py-3 text-sm text-muted-foreground whitespace-pre-wrap">{plain}</div>;
}

// ── Sub-components ──────────────────────────────────────────────

const ProgressBar = forwardRef<HTMLDivElement, { progress: number; onSeek: (pct: number) => void }>(
  function ProgressBar({ progress, onSeek }, ref) {
    const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
    }, [onSeek]);
    return (
      <div ref={ref} className="flex-1 h-1.5 bg-secondary rounded-full cursor-pointer group relative" onClick={handleClick}>
        <div className="h-full bg-primary rounded-full transition-[width] duration-100" style={{ width: `${progress}%` }} />
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
          style={{ left: `${progress}%`, marginLeft: "-6px" }} />
      </div>
    );
  }
);

function VolumeSlider({ volume, onChange }: { volume: number; onChange: (v: number) => void }) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
  }, [onChange]);
  return (
    <div className="w-16 h-1 bg-secondary rounded-full cursor-pointer group" onClick={handleClick}>
      <div className="h-full bg-muted-foreground group-hover:bg-primary rounded-full transition-colors" style={{ width: `${volume * 100}%` }} />
    </div>
  );
}
