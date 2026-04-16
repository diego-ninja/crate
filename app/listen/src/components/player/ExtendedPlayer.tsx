import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";

import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { useVisualizerConfig } from "@/components/player/visualizer/useVisualizerConfig";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import { AppPopover } from "@/components/ui/AppPopover";
import { usePlayer } from "@/contexts/PlayerContext";
import { useIsDesktop } from "@/hooks/use-breakpoint";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { useEscapeKey } from "@/hooks/use-escape-key";

type TabId = "queue" | "suggested" | "lyrics" | "info";

interface ExtendedPlayerProps {
  open: boolean;
  onClose: () => void;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "queue", label: "Queue" },
  { id: "suggested", label: "Suggested" },
  { id: "lyrics", label: "Lyrics" },
  { id: "info", label: "Info" },
];

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  const isDesktop = useIsDesktop();
  const { currentTrack, isPlaying, volume, analyserVersion } = usePlayer();
  const [tab, setTab] = useState<TabId>("queue");
  const [showVizSettings, setShowVizSettings] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const vizSettingsRef = useRef<HTMLDivElement>(null);
  const vizSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const playbackState = useMemo(() => ({ isPlaying, volume }), [isPlaying, volume]);
  const vizRef = useMusicVisualizer(
    canvasRef,
    `${currentTrack?.id ?? "none"}:${analyserVersion}`,
    open && isDesktop,
    playbackState,
  );
  const vizCfg = useVisualizerConfig(vizRef, currentTrack, open && isDesktop);
  const [canvasRect, setCanvasRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // Measure cover position relative to the left panel, expand 15%
  useEffect(() => {
    if (!open || !isDesktop) return;
    const measure = () => {
      const cover = coverRef.current;
      const panel = panelRef.current;
      if (!cover || !panel) return;
      const cr = cover.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      // Skip measurement if panel is still animating (off-screen)
      if (pr.top > window.innerHeight * 0.5) return;
      const expand = 0.40;
      const ew = cr.width * expand;
      const eh = cr.height * expand;
      setCanvasRect({
        top: cr.top - pr.top - eh / 2,
        left: cr.left - pr.left - ew / 2,
        width: cr.width + ew,
        height: cr.height + eh,
      });
    };
    // Wait for open animation to settle before first measure
    const t1 = window.setTimeout(measure, 550);
    const resizeObs = new ResizeObserver(measure);
    if (coverRef.current) resizeObs.observe(coverRef.current);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(t1);
      resizeObs.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, isDesktop, showVizSettings]);

  useDismissibleLayer({
    active: showVizSettings,
    refs: [vizSettingsRef, vizSettingsButtonRef],
    onDismiss: () => setShowVizSettings(false),
    closeOnEscape: false,
  });

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (showVizSettings) {
        setShowVizSettings(false);
        return;
      }
      onClose();
    },
    [onClose, showVizSettings],
  );

  useEscapeKey(open, handleEscape);

  if (!isDesktop || !currentTrack) return null;

  return (
    <div
      className={`z-app-extended-player fixed inset-0 flex bg-app-surface transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? "top-0 opacity-100" : "pointer-events-none top-[100vh] opacity-0"
      }`}
    >
      <div ref={panelRef} className="relative flex w-1/2 flex-col items-center justify-center overflow-hidden bg-app-surface">
        <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
          <button
            onClick={onClose}
            aria-label="Close player"
            className="rounded-full bg-black/30 p-2 text-white/60 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
          >
            <ChevronDown size={20} />
          </button>
          <button
            ref={vizSettingsButtonRef}
            onClick={() => setShowVizSettings(!showVizSettings)}
            aria-label="Visualizer settings"
            className={`rounded-full p-2 backdrop-blur-sm transition-colors ${
              showVizSettings
                ? "bg-primary/20 text-primary"
                : "bg-black/30 text-white/40 hover:text-white/70"
            }`}
          >
            <Settings size={18} />
          </button>
        </div>

        {showVizSettings ? (
          <AppPopover ref={vizSettingsRef} className="absolute top-14 right-4 w-56 p-4">
            <VisualizerSettingsPanel config={vizCfg} />
          </AppPopover>
        ) : null}

        {/* Album cover */}
        <div ref={coverRef} className="relative z-0 aspect-square w-[70%] max-w-[480px] shrink-0">
          <div className="absolute inset-6 rounded-[28px] bg-primary/10 opacity-70 blur-3xl" />
          <div className="absolute inset-2 rounded-[26px] border border-white/10 bg-white/[0.02]" />
          {currentTrack.albumCover ? (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
              style={{ filter: vizCfg.vizEnabled ? "grayscale(100%) brightness(0.35)" : "none" }}
            />
          ) : (
            <div className="absolute inset-0 rounded-xl bg-white/5 shadow-[0_28px_100px_rgba(0,0,0,0.75)]" />
          )}
        </div>

        {/* WebGL canvas — 15% larger than cover, centered, maintains aspect ratio on resize */}
        <div
          className={`pointer-events-none absolute ${showVizSettings ? "z-30" : "z-10"} ${
            vizCfg.vizEnabled && canvasRect ? "" : "hidden"
          }`}
          style={canvasRect ? { top: canvasRect.top, left: canvasRect.left, width: canvasRect.width, height: canvasRect.height } : undefined}
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            style={{ background: "transparent" }}
          />
        </div>

        <div className="relative z-20 mt-6 max-w-full px-8 text-center">
          <h2 className="truncate text-xl font-bold leading-tight text-white">
            {currentTrack.title}
          </h2>
          <p className="mt-1 truncate text-base text-white/50">{currentTrack.artist}</p>
          {currentTrack.album ? (
            <p className="mt-0.5 truncate text-sm text-white/25">{currentTrack.album}</p>
          ) : null}
          {vizCfg.trackAdaptiveViz && vizCfg.trackVizProfile.hasAnalysis && vizCfg.trackVizProfile.summary ? (
            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.22em] text-white/35">
              spheres · {vizCfg.trackVizProfile.summary}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex w-1/2 flex-col bg-app-surface">
        <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
                tab === item.id ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
          {tab === "queue" && <QueueTab />}
          {tab === "suggested" && <SuggestedTab />}
          {tab === "lyrics" && <LyricsTab useAlbumPalette={vizCfg.useAlbumPalette} />}
          {tab === "info" && <InfoTab />}
        </div>
      </div>
    </div>
  );
}
