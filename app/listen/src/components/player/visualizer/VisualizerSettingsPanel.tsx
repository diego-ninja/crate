import type { VisualizerConfigState } from "./useVisualizerConfig";

interface VisualizerSettingsPanelProps {
  config: VisualizerConfigState;
  className?: string;
}

const SLIDERS = [
  {
    key: "separation" as const,
    label: "Separation",
    min: 0,
    max: 0.5,
    step: 0.01,
  },
  { key: "glow" as const, label: "Glow", min: 0, max: 15, step: 0.5 },
  { key: "scale" as const, label: "Scale", min: 0.2, max: 3, step: 0.1 },
  {
    key: "persistence" as const,
    label: "Persistence",
    min: 0,
    max: 2,
    step: 0.1,
  },
  { key: "octaves" as const, label: "Octaves", min: 1, max: 5, step: 1 },
] as const;

function Toggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onToggle}
      className={`h-5 w-9 rounded-full transition-colors ${
        on ? "bg-accent-action" : "bg-border-interactive"
      }`}
    >
      <div
        className={` size-4 rounded-full bg-text-primary shadow transition-transform ${
          on ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export function VisualizerSettingsPanel({
  config,
  className,
}: VisualizerSettingsPanelProps) {
  const {
    surfaceMode,
    vizEnabled,
    useAlbumPalette,
    trackAdaptiveViz,
    vizConfig,
    effectiveVizConfig,
    trackVizProfile,
    toggleAlbumPalette,
    toggleTrackAdaptive,
    updateConfig,
    resetConfig,
  } = config;

  return (
    <div className={`space-y-3 ${className ?? ""}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
          Visualizer settings
        </span>
        <button
          onClick={resetConfig}
          className="text-xs text-accent-action hover:underline"
        >
          Reset
        </button>
      </div>

      <div
        className={`flex items-center justify-between transition-opacity ${
          vizEnabled ? "" : "opacity-45"
        }`}
      >
        <span className="text-xs text-text-muted">Album palette</span>
        <Toggle
          label="Album palette"
          on={useAlbumPalette}
          onToggle={toggleAlbumPalette}
        />
      </div>

      <div
        className={`flex items-center justify-between transition-opacity ${
          vizEnabled ? "" : "opacity-45"
        }`}
      >
        <span className="text-xs text-text-muted">Track adaptive</span>
        <Toggle
          label="Track adaptive"
          on={trackAdaptiveViz}
          onToggle={toggleTrackAdaptive}
        />
      </div>

      <div className="rounded-md border border-border-quiet bg-surface-control px-2.5 py-2 text-xs text-text-muted">
        {!vizEnabled
          ? surfaceMode === "cd"
            ? "CD mode active"
            : "Cover mode active"
          : trackAdaptiveViz
            ? trackVizProfile.hasAnalysis
              ? `Using track analysis${
                  trackVizProfile.summary ? ` · ${trackVizProfile.summary}` : ""
                }`
              : "Adaptive on, waiting for track analysis"
            : "Adaptive off, using your saved base settings"}
      </div>

      {SLIDERS.map(({ key, label, min, max, step }) => (
        <div
          key={key}
          className={`transition-opacity ${vizEnabled ? "" : "opacity-45"}`}
        >
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-text-subtle">{label}</span>
            <div className="flex items-center gap-2 font-mono">
              {trackAdaptiveViz ? (
                <span className="text-text-subtle">
                  {vizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
                </span>
              ) : null}
              <span className="text-text-secondary">
                {effectiveVizConfig[key].toFixed(key === "octaves" ? 0 : 1)}
              </span>
            </div>
          </div>
          <input
            type="range"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={vizConfig[key]}
            disabled={!vizEnabled}
            onChange={(event) =>
              updateConfig({
                ...vizConfig,
                [key]: parseFloat(event.target.value),
              })
            }
            className="h-1 w-full accent-accent-action"
          />
        </div>
      ))}
    </div>
  );
}
