import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Settings } from "lucide-react";

import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import { useMusicVisualizer } from "@/components/player/visualizer/useMusicVisualizer";
import { useTrackVisualizerProfile } from "@/components/player/visualizer/useTrackVisualizerProfile";
import { AppPopover } from "@/components/ui/AppPopover";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useDismissibleLayer } from "@/hooks/use-dismissible-layer";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { extractPalette } from "@/lib/palette";
import {
  DEFAULT_VISUALIZER_SETTINGS,
  PLAYER_VIZ_PREFS_EVENT,
  getUseAlbumPalettePreference,
  getTrackAdaptiveVisualizerPreference,
  getVisualizerEnabledPreference,
  getVisualizerSettingsPreference,
  setTrackAdaptiveVisualizerPreference,
  setUseAlbumPalettePreference,
  setVisualizerEnabledPreference,
  setVisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";

type PaletteTriplet = [number, number, number];
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

const VIZ_DEFAULTS = DEFAULT_VISUALIZER_SETTINGS;
const DEFAULT_VIZ_COLORS: [PaletteTriplet, PaletteTriplet, PaletteTriplet] = [
  [0.024, 0.714, 0.831],
  [0.4, 0.9, 1],
  [0.1, 0.3, 0.8],
];
const ZERO_VIZ_DELTA = {
  separation: 0,
  glow: 0,
  scale: 0,
  persistence: 0,
  octaves: 0,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rgbToHsl([r, g, b]: PaletteTriplet): PaletteTriplet {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return [0, 0, lightness];
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  switch (max) {
    case r:
      hue = (g - b) / delta + (g < b ? 6 : 0);
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }

  return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, t: number) {
  let channel = t;
  if (channel < 0) channel += 1;
  if (channel > 1) channel -= 1;
  if (channel < 1 / 6) return p + (q - p) * 6 * channel;
  if (channel < 1 / 2) return q;
  if (channel < 2 / 3) return p + (q - p) * (2 / 3 - channel) * 6;
  return p;
}

function hslToRgb([h, s, l]: PaletteTriplet): PaletteTriplet {
  if (s === 0) {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ];
}

function adjustPaletteColor(
  [r, g, b]: PaletteTriplet,
  brightness: number,
  coolness: number,
  saturation: number,
  hueShift: number,
): PaletteTriplet {
  const avg = (r + g + b) / 3;
  const sat = 1 + saturation;
  const sr = avg + (r - avg) * sat;
  const sg = avg + (g - avg) * sat;
  const sb = avg + (b - avg) * sat;
  const [h, s, l] = rgbToHsl([
    clamp(sr + brightness - coolness * 0.4, 0, 1),
    clamp(sg + brightness * 0.8 - coolness * 0.05, 0, 1),
    clamp(sb + brightness * 0.45 + coolness, 0, 1),
  ]);

  return hslToRgb([
    (h + hueShift + 1) % 1,
    clamp(s + Math.abs(hueShift) * 0.12, 0, 1),
    l,
  ]);
}

export function ExtendedPlayer({ open, onClose }: ExtendedPlayerProps) {
  const { currentTrack, audioElement } = usePlayerActions();
  const [tab, setTab] = useState<TabId>("queue");
  const [showVizSettings, setShowVizSettings] = useState(false);
  const [vizConfig, setVizConfig] = useState(getVisualizerSettingsPreference);
  const [useAlbumPalette, setUseAlbumPalette] = useState(getUseAlbumPalettePreference);
  const [vizEnabled, setVizEnabled] = useState(getVisualizerEnabledPreference);
  const [trackAdaptiveViz, setTrackAdaptiveViz] = useState(getTrackAdaptiveVisualizerPreference);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizSettingsRef = useRef<HTMLDivElement>(null);
  const vizSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const vizRef = useMusicVisualizer(canvasRef, audioElement, open && vizEnabled);
  const trackVizProfile = useTrackVisualizerProfile(currentTrack, trackAdaptiveViz);
  const effectiveVizDelta = trackAdaptiveViz ? trackVizProfile.settingsDelta : ZERO_VIZ_DELTA;
  const effectiveVizConfig = {
    separation: clamp(vizConfig.separation + effectiveVizDelta.separation, 0, 0.5),
    glow: clamp(vizConfig.glow + effectiveVizDelta.glow, 0, 15),
    scale: clamp(vizConfig.scale + effectiveVizDelta.scale, 0.2, 3),
    persistence: clamp(vizConfig.persistence + effectiveVizDelta.persistence, 0, 2),
    octaves: clamp(vizConfig.octaves + effectiveVizDelta.octaves, 1, 5),
  };

  useEffect(() => {
    const syncPreference = () => {
      setUseAlbumPalette(getUseAlbumPalettePreference());
      setVizConfig(getVisualizerSettingsPreference());
      setVizEnabled(getVisualizerEnabledPreference());
      setTrackAdaptiveViz(getTrackAdaptiveVisualizerPreference());
    };
    window.addEventListener("storage", syncPreference);
    window.addEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    return () => {
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener(PLAYER_VIZ_PREFS_EVENT, syncPreference as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!showVizSettings) return;
    setUseAlbumPalette(getUseAlbumPalettePreference());
    setVizConfig(getVisualizerSettingsPreference());
    setVizEnabled(getVisualizerEnabledPreference());
    setTrackAdaptiveViz(getTrackAdaptiveVisualizerPreference());
  }, [showVizSettings]);

  useDismissibleLayer({
    active: showVizSettings,
    refs: [vizSettingsRef, vizSettingsButtonRef],
    onDismiss: () => setShowVizSettings(false),
    closeOnEscape: false,
  });

  useEffect(() => {
    if (!open || !vizEnabled) return;

    const [defaultC1, defaultC2, defaultC3] = DEFAULT_VIZ_COLORS;
    const paletteBias = trackAdaptiveViz
      ? trackVizProfile.paletteBias
      : { brightness: 0, coolness: 0, saturation: 0, hueShift: 0 };
    const timers: number[] = [];

    const applyColors = (colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet]) => {
      const [c1, c2, c3] = colors.map((color) =>
        adjustPaletteColor(
          color,
          paletteBias.brightness,
          paletteBias.coolness,
          paletteBias.saturation,
          paletteBias.hueShift,
        ),
      ) as [PaletteTriplet, PaletteTriplet, PaletteTriplet];

      if (vizRef.current) {
        vizRef.current.color1 = c1;
        vizRef.current.color2 = c2;
        vizRef.current.color3 = c3;
      }
    };

    const scheduleColorApply = (colors: [PaletteTriplet, PaletteTriplet, PaletteTriplet]) => {
      const apply = () => applyColors(colors);
      apply();
      timers.push(window.setTimeout(apply, 120));
      timers.push(window.setTimeout(apply, 420));
      timers.push(window.setTimeout(apply, 900));
    };

    if (!useAlbumPalette) {
      scheduleColorApply([defaultC1, defaultC2, defaultC3]);
      return () => {
        for (const timer of timers) window.clearTimeout(timer);
      };
    }

    if (!currentTrack?.albumCover) return;

    let cancelled = false;
    extractPalette(currentTrack.albumCover)
      .then(([c1, c2, c3]) => {
        if (cancelled) return;
        scheduleColorApply([c1, c2, c3]);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [
    currentTrack?.albumCover,
    currentTrack?.id,
    open,
    trackAdaptiveViz,
    trackVizProfile.paletteBias,
    useAlbumPalette,
    vizEnabled,
    vizRef,
  ]);

  useEffect(() => {
    const apply = () => {
      if (vizRef.current) {
        vizRef.current.setMode("spheres");
        vizRef.current.separation = effectiveVizConfig.separation;
        vizRef.current.glow = effectiveVizConfig.glow;
        vizRef.current.scale = effectiveVizConfig.scale;
        vizRef.current.persistence = effectiveVizConfig.persistence;
        vizRef.current.octaves = effectiveVizConfig.octaves;
        vizRef.current.orbitSpeed = trackAdaptiveViz ? trackVizProfile.motion.orbitSpeed : 1;
        vizRef.current.cameraDrift = trackAdaptiveViz ? trackVizProfile.motion.cameraDrift : 1;
        vizRef.current.cameraDepth = trackAdaptiveViz ? trackVizProfile.motion.cameraDepth : 0;
        vizRef.current.pulseGain = trackAdaptiveViz ? trackVizProfile.motion.pulseGain : 1;
        vizRef.current.turbulence = trackAdaptiveViz ? trackVizProfile.motion.turbulence : 1;
        vizRef.current.orbitPhase = trackAdaptiveViz ? trackVizProfile.motion.orbitPhase : 0;
        vizRef.current.shellDensity = trackAdaptiveViz ? trackVizProfile.motion.shellDensity : 1;
        vizRef.current.beatResponse = trackAdaptiveViz ? trackVizProfile.motion.beatResponse : 1;
        vizRef.current.beatDecay = trackAdaptiveViz ? trackVizProfile.motion.beatDecay : 0.88;
        vizRef.current.sectionRate = trackAdaptiveViz ? trackVizProfile.motion.sectionRate : 1;
        vizRef.current.sectionDepth = trackAdaptiveViz ? trackVizProfile.motion.sectionDepth : 0.12;
        vizRef.current.lowBandWeight = trackAdaptiveViz ? trackVizProfile.motion.lowBandWeight : 1;
        vizRef.current.midBandWeight = trackAdaptiveViz ? trackVizProfile.motion.midBandWeight : 1;
        vizRef.current.highBandWeight = trackAdaptiveViz ? trackVizProfile.motion.highBandWeight : 1;
      }
    };
    apply();
    const timer = window.setTimeout(apply, 300);
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, effectiveVizConfig, open, trackAdaptiveViz, trackVizProfile, vizRef]);

  useEffect(() => {
    if (!open || !vizEnabled || !currentTrack) return;

    let attempts = 0;
    let timer = 0;

    const applyAccent = () => {
      attempts += 1;
      if (vizRef.current) {
        vizRef.current.accentTrackChange(trackAdaptiveViz ? 1 : 0.75);
        return;
      }
      if (attempts < 8) {
        timer = window.setTimeout(applyAccent, 80);
      }
    };

    applyAccent();
    return () => window.clearTimeout(timer);
  }, [currentTrack?.id, open, trackAdaptiveViz, vizEnabled, vizRef]);

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

  if (!currentTrack) return null;

  const updateVizConfig = (next: typeof vizConfig) => {
    setVizConfig(next);
    setVisualizerSettingsPreference(next);
  };

  return (
    <div
      className={`z-app-extended-player fixed inset-0 bottom-[72px] flex bg-app-surface transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
        open ? "top-0 opacity-100" : "pointer-events-none top-[100vh] opacity-0"
      }`}
    >
      <div className="relative flex w-1/2 flex-col items-center justify-center overflow-hidden bg-app-surface">
        <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
          <button
            onClick={onClose}
            className="rounded-full bg-black/30 p-2 text-white/60 backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white"
          >
            <ChevronDown size={20} />
          </button>
          <button
            ref={vizSettingsButtonRef}
            onClick={() => setShowVizSettings(!showVizSettings)}
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
          <AppPopover ref={vizSettingsRef} className="absolute top-14 right-4 w-56 space-y-3 p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">Visualizer</span>
              <button
                onClick={() => updateVizConfig(VIZ_DEFAULTS)}
                className="text-[10px] text-primary hover:underline"
              >
                Reset
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50">Enabled</span>
              <button
                onClick={() => {
                  const next = !vizEnabled;
                  setVizEnabled(next);
                  setVisualizerEnabledPreference(next);
                }}
                className={`h-5 w-9 rounded-full transition-colors ${
                  vizEnabled ? "bg-primary" : "bg-white/20"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    vizEnabled ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50">Album palette</span>
              <button
                onClick={() => {
                  const next = !useAlbumPalette;
                  setUseAlbumPalette(next);
                  setUseAlbumPalettePreference(next);
                }}
                className={`h-5 w-9 rounded-full transition-colors ${
                  useAlbumPalette ? "bg-primary" : "bg-white/20"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    useAlbumPalette ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-white/50">Track adaptive</span>
              <button
                onClick={() => {
                  const next = !trackAdaptiveViz;
                  setTrackAdaptiveViz(next);
                  setTrackAdaptiveVisualizerPreference(next);
                }}
                className={`h-5 w-9 rounded-full transition-colors ${
                  trackAdaptiveViz ? "bg-primary" : "bg-white/20"
                }`}
              >
                <div
                  className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    trackAdaptiveViz ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[10px] text-white/45">
              {trackAdaptiveViz
                ? trackVizProfile.hasAnalysis
                  ? `Using track analysis${trackVizProfile.summary ? ` · ${trackVizProfile.summary}` : ""}`
                  : "Adaptive on, waiting for track analysis"
                : "Adaptive off, using your saved base settings"}
            </div>

            {[
              { key: "separation" as const, label: "Separation", min: 0, max: 0.5, step: 0.01 },
              { key: "glow" as const, label: "Glow", min: 0, max: 15, step: 0.5 },
              { key: "scale" as const, label: "Scale", min: 0.2, max: 3, step: 0.1 },
              { key: "persistence" as const, label: "Persistence", min: 0, max: 2, step: 0.1 },
              { key: "octaves" as const, label: "Octaves", min: 1, max: 5, step: 1 },
            ].map(({ key, label, min, max, step }) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-[10px]">
                  <span className="text-white/40">{label}</span>
                  <div className="flex items-center gap-2 font-mono">
                    {trackAdaptiveViz ? (
                      <span className="text-white/35">
                        {vizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
                      </span>
                    ) : null}
                    <span className="text-white/60">
                      {effectiveVizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={vizConfig[key]}
                  onChange={(event) =>
                    updateVizConfig({
                      ...vizConfig,
                      [key]: parseFloat(event.target.value),
                    })
                  }
                  className="h-1 w-full accent-primary"
                />
              </div>
            ))}
          </AppPopover>
        ) : null}

        <div className="relative z-0 aspect-square w-[70%] max-w-[480px] shrink-0">
          <div className="absolute inset-6 rounded-[28px] bg-primary/10 opacity-70 blur-3xl" />
          <div className="absolute inset-2 rounded-[26px] border border-white/10 bg-white/[0.02]" />
          {currentTrack.albumCover ? (
            <img
              src={currentTrack.albumCover}
              alt=""
              className="absolute inset-0 h-full w-full rounded-xl object-cover shadow-[0_28px_100px_rgba(0,0,0,0.75),0_10px_28px_rgba(0,0,0,0.45)]"
              style={{ filter: vizEnabled ? "grayscale(100%) brightness(0.35)" : "none" }}
            />
          ) : (
            <div className="absolute inset-0 rounded-xl bg-white/5 shadow-[0_28px_100px_rgba(0,0,0,0.75)]" />
          )}
        </div>

        <canvas
          ref={canvasRef}
          className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${
            vizEnabled ? "" : "hidden"
          }`}
          style={{ background: "transparent" }}
        />

        <div className="relative z-20 mt-6 max-w-full px-8 text-center">
          <h2 className="truncate text-xl font-bold leading-tight text-white">
            {currentTrack.title}
          </h2>
          <p className="mt-1 truncate text-base text-white/50">{currentTrack.artist}</p>
          {currentTrack.album ? (
            <p className="mt-0.5 truncate text-sm text-white/25">{currentTrack.album}</p>
          ) : null}
          {trackAdaptiveViz && trackVizProfile.hasAnalysis && trackVizProfile.summary ? (
            <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.22em] text-white/35">
              spheres · {trackVizProfile.summary}
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
          {tab === "lyrics" && <LyricsTab useAlbumPalette={useAlbumPalette} />}
          {tab === "info" && <InfoTab />}
        </div>
      </div>
    </div>
  );
}
