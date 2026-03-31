import { useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import {
  Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  Heart, MoreHorizontal, Volume2, VolumeX, Airplay, ListMusic,
  Mic2, Maximize2, User, Share2, Plus, Disc, Loader2, ArrowLeft,
} from "lucide-react";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { useLikedTracks } from "@/contexts/LikedTracksContext";
import { usePlaylistComposer } from "@/contexts/PlaylistComposerContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { AppMenuButton, AppPopover } from "@/components/ui/AppPopover";
import { type PlaylistComposerTrack } from "@/components/playlists/PlaylistCreateModal";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { QueuePanel } from "@/components/player/QueuePanel";
import { LyricsPanel } from "@/components/player/LyricsPanel";
import { ExtendedPlayer } from "@/components/player/ExtendedPlayer";

interface PlaylistOption {
  id: number;
  name: string;
}

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
  const { currentTime, duration, isPlaying, isBuffering, volume } = usePlayer();
  const {
    currentTrack, shuffle, repeat, playSource, queue, currentIndex,
    pause, resume, next, prev, seek, setVolume,
    toggleShuffle, cycleRepeat, audioElement,
  } = usePlayerActions();

  // Connect audio to Web Audio API — this creates the AudioContext + source node
  // on first play, enabling the WebGL visualizer in ExtendedPlayer to work.
  const { frequencies } = useAudioVisualizer(audioElement, isPlaying);

  const navigate = useNavigate();
  const [fsOpen, setFsOpen] = useState(false);
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const { isLiked, likeTrack, unlikeTrack } = useLikedTracks();
  const { openCreatePlaylist } = usePlaylistComposer();
  const { data: playlists } = useApi<PlaylistOption[]>("/api/playlists");

  useDismissibleLayer({
    active: showMenu,
    refs: [menuRef, menuButtonRef],
    onDismiss: () => {
      setShowMenu(false);
      setShowPlaylistPicker(false);
    },
    closeOnEscape: false,
  });

  useDismissibleLayer({
    active: showVolume,
    refs: [volumeRef, volumeButtonRef],
    onDismiss: () => setShowVolume(false),
    closeOnEscape: false,
  });

  useDismissibleLayer({
    active: showMenu || showVolume || showQueue || showLyrics,
    refs: [],
    onDismiss: () => {
      setShowMenu(false);
      setShowVolume(false);
      setShowQueue(false);
      setShowLyrics(false);
    },
    closeOnPointerDownOutside: false,
  });

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const pseudoBars = useMemo(() => currentTrack ? generateBars(currentTrack.id, 80) : [], [currentTrack?.id]);
  const fmt = currentTrack ? formatBadge(currentTrack) : null;
  const hasFloatingOverlayOpen = showVolume || showMenu;

  if (!currentTrack) return null;

  const liked = isLiked(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id);

  async function toggleLike() {
    if (!currentTrack) return;
    const trackId = currentTrack.libraryTrackId ?? null;
    const trackPath = currentTrack.path || currentTrack.id;
    try {
      if (liked) {
        await unlikeTrack(trackId, trackPath);
      } else {
        await likeTrack(trackId, trackPath);
      }
    } catch { /* ignore */ }
  }

  function currentTrackToPlaylistSeed(): PlaylistComposerTrack | null {
    if (!currentTrack) return null;
    return {
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      duration: duration || 0,
      path: currentTrack.path,
      libraryTrackId: currentTrack.libraryTrackId,
      navidromeId: currentTrack.navidromeId,
    };
  }

  async function handleAddCurrentTrackToPlaylist(playlistId: number) {
    if (!currentTrack?.path) {
      toast.error("This track cannot be added to a playlist yet");
      return;
    }
    try {
      const payload = {
        tracks: [{
          path: currentTrack.path,
          title: currentTrack.title,
          artist: currentTrack.artist,
          album: currentTrack.album || "",
          duration: duration || 0,
        }],
      };
      await api(`/api/playlists/${playlistId}/tracks`, "POST", payload);
      toast.success("Added to playlist");
      setShowMenu(false);
      setShowPlaylistPicker(false);
    } catch {
      toast.error("Failed to add track to playlist");
    }
  }

  return (
    <>
      <div className={`fixed bottom-0 left-0 right-0 h-[72px] bg-[#0c0c14] border-t border-white/5 ${hasFloatingOverlayOpen ? "z-[90]" : "z-50"}`}>
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
              {isBuffering && (
                <p className="text-[10px] text-primary/80 truncate leading-tight mt-0.5">
                  Buffering...
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
                ref={menuButtonRef}
                onClick={() => {
                  setShowPlaylistPicker(false);
                  setShowMenu(!showMenu);
                }}
                className="shrink-0 p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60"
              >
                <MoreHorizontal size={16} />
              </button>
              {showMenu && currentTrack && (
                <AppPopover ref={menuRef} className="absolute bottom-full left-0 z-[60] mb-2 w-52 py-1.5">
                  {showPlaylistPicker ? (
                    <>
                      <AppMenuButton
                        onClick={() => setShowPlaylistPicker(false)}
                        className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
                      >
                        <ArrowLeft size={14} className="text-white/40 shrink-0" />
                        Back
                      </AppMenuButton>
                      <div className="mx-3 my-1 h-px bg-white/10" />
                      <AppMenuButton
                        onClick={() => {
                          const seed = currentTrackToPlaylistSeed();
                          if (seed) {
                            openCreatePlaylist({ tracks: [seed] });
                          } else {
                            openCreatePlaylist();
                          }
                          setShowMenu(false);
                          setShowPlaylistPicker(false);
                        }}
                        className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
                      >
                        <Plus size={14} className="text-white/40 shrink-0" />
                        Add new playlist
                      </AppMenuButton>
                      <div className="mx-3 my-1 h-px bg-white/10" />
                      {playlists && playlists.length > 0 ? (
                        playlists.map((playlist) => (
                          <AppMenuButton
                            key={playlist.id}
                            onClick={() => void handleAddCurrentTrackToPlaylist(playlist.id)}
                            className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
                          >
                            <ListMusic size={14} className="text-white/40 shrink-0" />
                            {playlist.name}
                          </AppMenuButton>
                        ))
                      ) : (
                        <div className="px-4 py-2 text-[12px] text-white/45">No playlists yet</div>
                      )}
                    </>
                  ) : (
                    [
                      { icon: Plus, label: "Add to playlist", action: () => setShowPlaylistPicker(true) },
                      { icon: Disc, label: "Add to my collection", action: () => {
                        likeTrack(currentTrack.libraryTrackId ?? null, currentTrack.path || currentTrack.id).then(() => {
                          toast.success("Added to collection");
                        }).catch(() => {});
                        setShowMenu(false);
                      }},
                      { icon: User, label: "Go to artist", action: () => {
                        navigate(`/artist/${encPath(currentTrack.artist)}`);
                        setShowMenu(false);
                      } },
                      { icon: Disc, label: "Go to album", action: () => {
                        if (currentTrack.album) {
                          navigate(`/album/${encPath(currentTrack.artist)}/${encPath(currentTrack.album)}`);
                        }
                        setShowMenu(false);
                      } },
                      { icon: Share2, label: "Share", action: () => {
                        navigator.clipboard.writeText(`${currentTrack.title} - ${currentTrack.artist}`).then(() => toast.success("Copied to clipboard")).catch(() => {});
                        setShowMenu(false);
                      }},
                    ].map(({ icon: Icon, label, action }) => (
                      <AppMenuButton
                        key={label}
                        onClick={action}
                        className="rounded-none px-4 py-2 text-[13px] text-white/70 hover:text-white"
                      >
                        <Icon size={14} className="text-white/40 shrink-0" />
                        {label}
                      </AppMenuButton>
                    ))
                  )}
                </AppPopover>
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
                {isBuffering ? (
                  <Loader2 size={15} className="animate-spin text-black" />
                ) : isPlaying ? (
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
                {/* Waveform bars — blend real frequencies with pseudo-random base */}
                {pseudoBars.map((base, i) => {
                  const barPct = ((i + 0.5) / pseudoBars.length) * 100;
                  const played = barPct <= progress;
                  // Map bar index to frequency bin
                  const freqIdx = Math.floor((i / pseudoBars.length) * frequencies.length);
                  const freq = frequencies[freqIdx] ?? 0;
                  // Blend: base shape + real audio reactivity
                  const h = isPlaying ? Math.max(base * 0.3, base * 0.4 + freq * 0.6) : base;
                  return (
                    <div
                      key={i}
                      className="flex-1 mx-px rounded-sm"
                      style={{
                        height: `${h * 100}%`,
                        backgroundColor: played ? "rgba(6,182,212,0.6)" : "rgba(255,255,255,0.08)",
                        transition: "height 0.1s ease-out",
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
                ref={volumeButtonRef}
                onClick={() => setShowVolume(!showVolume)}
                className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60"
              >
                {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {showVolume && (
                <AppPopover ref={volumeRef} className="absolute bottom-full left-1/2 z-[90] -translate-x-1/2 mb-2 rounded-lg p-2">
                  <input
                    type="range"
                    min={0} max={1} step={0.01}
                    value={volume}
                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="w-24 accent-cyan-400 h-1"
                    style={{ writingMode: "horizontal-tb" }}
                  />
                </AppPopover>
              )}
            </div>

            {/* Device (placeholder) */}
            <button className="p-1.5 hover:bg-white/5 rounded-md transition-colors text-white/30 hover:text-white/60" title="Connect device">
              <Airplay size={16} />
            </button>

            {/* Queue (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => { setShowQueue(!showQueue); setShowLyrics(false); }}
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors relative ${showQueue ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                title="Queue"
              >
                <ListMusic size={16} />
                {queue.length > 1 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-primary text-[8px] font-bold text-primary-foreground rounded-full flex items-center justify-center">
                    {queue.length - currentIndex - 1}
                  </span>
                )}
              </button>
            )}

            {/* Lyrics (hidden when extended player is open) */}
            {!extendedOpen && (
              <button
                onClick={() => { setShowLyrics(!showLyrics); setShowQueue(false); }}
                className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${showLyrics ? "text-primary" : "text-white/30 hover:text-white/60"}`}
                title="Lyrics"
              >
                <Mic2 size={16} />
              </button>
            )}

            {/* Extended / Full player */}
            <button
              onClick={() => {
                setExtendedOpen(!extendedOpen);
                if (!extendedOpen) { setShowQueue(false); setShowLyrics(false); }
              }}
              className={`p-1.5 hover:bg-white/5 rounded-md transition-colors ${extendedOpen ? "text-primary" : "text-white/30 hover:text-white/60"}`}
              title="Extended player"
            >
              <Maximize2 size={16} />
            </button>
          </div>

        </div>
      </div>
      <QueuePanel open={showQueue} onClose={() => setShowQueue(false)} />
      <LyricsPanel open={showLyrics} onClose={() => setShowLyrics(false)} />
      <ExtendedPlayer open={extendedOpen} onClose={() => setExtendedOpen(false)} />
      <FullscreenPlayer open={fsOpen} onClose={() => setFsOpen(false)} />
    </>
  );
}
