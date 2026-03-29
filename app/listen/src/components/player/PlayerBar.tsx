import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, MoreHorizontal, Volume2, VolumeX, Airplay, ListMusic,
  Mic2, Maximize2, Radio, Info, User, Share2, Plus, Disc,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatBadge(track: { id: string }): string | null {
  const id = track.id.toLowerCase();
  if (id.endsWith(".flac")) return "FLAC";
  if (id.endsWith(".mp3")) return "MP3";
  if (id.endsWith(".ogg")) return "OGG";
  if (id.endsWith(".opus")) return "OPUS";
  if (id.endsWith(".m4a") || id.endsWith(".aac")) return "AAC";
  if (id.endsWith(".wav")) return "WAV";
  return null;
}

// Deterministic pseudo-waveform bars from track ID
function generateBars(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = ((h * 1103515245 + 12345) & 0x7fffffff);
    bars.push(0.15 + (h % 1000) / 1000 * 0.85);
  }
  return bars;
}

export function PlayerBar() {
  const { currentTime, duration, isPlaying, volume } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat,
  } = usePlayerActions();

  const navigate = useNavigate();
  const [fsOpen, setFsOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bars = useMemo(() => currentTrack ? generateBars(currentTrack.id, 80) : [], [currentTrack?.id]);
  const fmt = currentTrack ? formatBadge(currentTrack) : null;

  if (!currentTrack) return null;

  async function toggleLike() {
    if (!currentTrack) return;
    const path = currentTrack.id;
    try {
      if (liked) {
        await api("/api/me/likes", "DELETE", { track_path: path });
        setLiked(false);
      } else {
        await api("/api/me/likes", "POST", { track_path: path });
        setLiked(true);
      }
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[72px] bg-[#0c0c14] border-t border-white/5">
        <div className="h-full flex items-center px-4 gap-2">

          {/* ── Block 1: Track Info ── */}
          <div className="flex items-center gap-3 w-[280px] shrink-0">
            {/* Album art */}
            <div className="relative w-12 h-12 rounded-md overflow-hidden shrink-0 bg-white/5">
              {currentTrack.albumCover ? (
                <img src={currentTrack.albumCover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-white/10" />
              )}
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white truncate leading-tight">
                {currentTrack.title}
              </p>
              <p className="text-[11px] text-white/50 truncate leading-tight mt-0.5">
                {currentTrack.artist}
              </p>
              {playSource && (
                <p className="text-[10px] text-white/30 truncate leading-tight mt-0.5">
                  Playing from: {playSource.name}
                </p>
              )}
            </div>

            {/* Heart */}
            <button onClick={toggleLike} className="shrink-0 p-1.5 hover:bg-white/5 rounded-md transition-colors">
              <Heart size={16} className={liked ? "text-primary fill-primary" : "text-white/30 hover:text-white/60"} />
            </button>

            {/* Menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="shrink-0 p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60"
              >
                <MoreHorizontal size={16} />
              </button>
              {showMenu && currentTrack && (
                <div className="absolute bottom-full left-0 mb-2 w-52 bg-[#16161e] border border-white/10 rounded-xl shadow-2xl py-1.5 z-[60]">
                  {[
                    { icon: Plus, label: "Add to playlist", action: () => toast.info("Coming soon") },
                    { icon: Disc, label: "Add to my collection", action: () => {
                      api("/api/me/likes", "POST", { track_path: currentTrack.id }).then(() => { setLiked(true); toast.success("Added to collection"); }).catch(() => {});
                    }},
                    { icon: Radio, label: "Go to track radio", action: () => toast.info("Coming soon") },
                    { icon: Info, label: "Track info", action: () => toast.info("Coming soon") },
                    { icon: User, label: "Go to artist", action: () => { navigate(`/artist/${encPath(currentTrack.artist)}`); } },
                    { icon: Share2, label: "Share", action: () => {
                      navigator.clipboard.writeText(`${currentTrack.title} - ${currentTrack.artist}`).then(() => toast.success("Copied to clipboard")).catch(() => {});
                    }},
                  ].map(({ icon: Icon, label, action }) => (
                    <button
                      key={label}
                      onClick={() => { action(); setShowMenu(false); }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      <Icon size={14} className="text-white/40 shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Block 2: Controls + Progress ── */}
          <div className="flex-1 flex flex-col items-center justify-center max-w-[600px] mx-auto gap-1">
            {/* Controls */}
            <div className="flex items-center gap-5">
              <button
                onClick={toggleShuffle}
                className={`transition-colors ${shuffle ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                <Shuffle size={15} />
              </button>
              <button onClick={prev} className="text-white/50 hover:text-white transition-colors">
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                onClick={isPlaying ? pause : resume}
                className="w-9 h-9 rounded-full bg-white flex items-center justify-center hover:scale-105 transition-transform"
              >
                {isPlaying ? (
                  <Pause size={16} className="text-black" />
                ) : (
                  <Play size={16} className="text-black ml-0.5" fill="black" />
                )}
              </button>
              <button onClick={next} className="text-white/50 hover:text-white transition-colors">
                <SkipForward size={18} fill="currentColor" />
              </button>
              <button
                onClick={cycleRepeat}
                className={`transition-colors ${repeat !== "off" ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              >
                {repeat === "one" ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
            </div>

            {/* Progress with waveform bars */}
            <div className="flex items-center gap-2 w-full">
              <span className="text-[10px] text-white/40 w-9 text-right tabular-nums font-mono">
                {formatTime(currentTime)}
              </span>
              <div
                className="flex-1 h-5 relative cursor-pointer group flex items-end"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  seek(pct * duration);
                }}
              >
                {/* Waveform bars */}
                {bars.map((h, i) => {
                  const barPct = ((i + 0.5) / bars.length) * 100;
                  const played = barPct <= progress;
                  return (
                    <div
                      key={i}
                      className="flex-1 mx-px rounded-sm transition-colors"
                      style={{
                        height: `${h * 100}%`,
                        backgroundColor: played ? "rgba(6,182,212,0.6)" : "rgba(255,255,255,0.08)",
                      }}
                    />
                  );
                })}
                {/* Progress line overlay */}
                <div
                  className="absolute top-0 bottom-0 left-0 pointer-events-none"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-[10px] text-white/40 w-9 tabular-nums font-mono">
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* ── Block 3: Action Buttons ── */}
          <div className="flex items-center gap-1 w-[280px] shrink-0 justify-end">
            {/* Format badge */}
            {fmt && (
              <span className="text-[9px] font-bold tracking-wider text-primary/70 border border-primary/30 rounded px-1.5 py-0.5 mr-1">
                {fmt}
              </span>
            )}

            {/* Volume */}
            <div className="relative flex items-center">
              <button
                onClick={() => setShowVolume(!showVolume)}
                className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60"
              >
                {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {showVolume && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[#16161e] border border-white/10 rounded-lg p-2 shadow-xl">
                  <input
                    type="range"
                    min={0} max={1} step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-24 accent-cyan-400 h-1"
                    style={{ writingMode: "horizontal-tb" }}
                  />
                </div>
              )}
            </div>

            {/* Device (placeholder) */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60" title="Connect device">
              <Airplay size={16} />
            </button>

            {/* Queue */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60 relative" title="Queue">
              <ListMusic size={16} />
              {queue.length > 1 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-primary text-[8px] font-bold text-primary-foreground rounded-full flex items-center justify-center">
                  {queue.length - currentIndex - 1}
                </span>
              )}
            </button>

            {/* Lyrics */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60" title="Lyrics">
              <Mic2 size={16} />
            </button>

            {/* Full player */}
            <button
              onClick={() => setFsOpen(true)}
              className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60"
              title="Full player"
            >
              <Maximize2 size={16} />
            </button>
          </div>

        </div>
      </div>
      <FullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />
    </>
  );
}
