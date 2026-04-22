import type { VisualizerConfigState } from "./useVisualizerConfig";

interface VisualizerSettingsPanelProps {
  config: VisualizerConfigState;
  className?: string;
}

const SLIDERS = [
  { key: "separation" as const, label: "Separation", min: 0, max: 0.5, step: 0.01 },
  { key: "glow" as const, label: "Glow", min: 0, max: 15, step: 0.5 },
  { key: "scale" as const, label: "Scale", min: 0.2, max: 3, step: 0.1 },
  { key: "persistence" as const, label: "Persistence", min: 0, max: 2, step: 0.1 },
  { key: "octaves" as const, label: "Octaves", min: 1, max: 5, step: 1 },
] as const;

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-white/20"}`}
    >
      <div
        className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4.5" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export function VisualizerSettingsPanel({ config, className }: VisualizerSettingsPanelProps) {
  const {
    vizEnabled, useAlbumPalette, trackAdaptiveViz,
    vizConfig, effectiveVizConfig, trackVizProfile,
    toggleEnabled, toggleAlbumPalette, toggleTrackAdaptive,
    updateConfig, resetConfig,
  } = config;

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Visualizer</span>
        <button onClick={resetConfig} className="text-[10px] text-primary hover:underline">Reset</button>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">Enabled</span>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-medium uppercase tracking-[0.16em] ${vizEnabled ? "text-primary" : "text-white/35"}`}>
            {vizEnabled ? "On" : "Off"}
          </span>
          <Toggle on={vizEnabled} onToggle={toggleEnabled} />
        </div>
      </div>

      <div className={`flex items-center justify-between transition-opacity ${vizEnabled ? "" : "opacity-45"}`}>
        <span className="text-[11px] text-muted-foreground">Album palette</span>
        <Toggle on={useAlbumPalette} onToggle={toggleAlbumPalette} />
      </div>

      <div className={`flex items-center justify-between transition-opacity ${vizEnabled ? "" : "opacity-45"}`}>
        <span className="text-[11px] text-muted-foreground">Track adaptive</span>
        <Toggle on={trackAdaptiveViz} onToggle={toggleTrackAdaptive} />
      </div>

      <div className="rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-2 text-[10px] text-muted-foreground">
        {!vizEnabled
          ? "Visualizer disabled"
          : trackAdaptiveViz
          ? trackVizProfile.hasAnalysis
            ? `Using track analysis${trackVizProfile.summary ? ` · ${trackVizProfile.summary}` : ""}`
            : "Adaptive on, waiting for track analysis"
          : "Adaptive off, using your saved base settings"}
      </div>

      {SLIDERS.map(({ key, label, min, max, step }) => (
        <div key={key} className={`transition-opacity ${vizEnabled ? "" : "opacity-45"}`}>
          <div className="mb-1 flex justify-between text-[10px]">
            <span className="text-white/40">{label}</span>
            <div className="flex items-center gap-2 font-mono">
              {trackAdaptiveViz ? (
                <span className="text-white/40">
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
            disabled={!vizEnabled}
            onChange={(event) =>
              updateConfig({ ...vizConfig, [key]: parseFloat(event.target.value) })
            }
            className="h-1 w-full accent-primary"
          />
        </div>
      ))}
    </div>
  );
}
