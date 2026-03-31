import { RotateCcw } from "lucide-react";

import {
  DEFAULT_VISUALIZER_SETTINGS,
  getUseAlbumPalettePreference,
  getVisualizerEnabledPreference,
  getVisualizerSettingsPreference,
  setUseAlbumPalettePreference,
  setVisualizerEnabledPreference,
  setVisualizerSettingsPreference,
  type VisualizerSettingsPreference,
} from "@/lib/player-visualizer-prefs";
import {
  getCrossfadeDurationPreference,
  setCrossfadeDurationPreference,
} from "@/lib/player-playback-prefs";
import { useState } from "react";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors ${checked ? "bg-primary" : "bg-white/10"}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}

function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70">
          {displayValue ?? value}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-400"
      />
    </div>
  );
}

export function Settings() {
  const [visualizerEnabled, setVisualizerEnabled] = useState(getVisualizerEnabledPreference);
  const [useAlbumPalette, setUseAlbumPalette] = useState(getUseAlbumPalettePreference);
  const [vizSettings, setVizSettings] = useState<VisualizerSettingsPreference>(getVisualizerSettingsPreference);
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);

  function updateVizSettings(next: Partial<VisualizerSettingsPreference>) {
    const merged = { ...vizSettings, ...next };
    setVizSettings(merged);
    setVisualizerSettingsPreference(merged);
  }

  function resetVisualizer() {
    setVizSettings(DEFAULT_VISUALIZER_SETTINGS);
    setVisualizerSettingsPreference(DEFAULT_VISUALIZER_SETTINGS);
    setVisualizerEnabledPreference(true);
    setUseAlbumPalettePreference(false);
    setVisualizerEnabled(true);
    setUseAlbumPalette(false);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fine-tune playback and visualizer behavior for this device.
        </p>
      </div>

      <Section
        title="Playback"
        description="These preferences shape how the player behaves between tracks."
      >
        <RangeRow
          label="Crossfade"
          description="Set a preferred crossfade length for compatible transitions. Albums meant to play continuously should still favor gapless playback."
          value={crossfadeSeconds}
          min={0}
          max={12}
          step={1}
          displayValue={crossfadeSeconds === 0 ? "Off" : `${crossfadeSeconds}s`}
          onChange={(value) => {
            setCrossfadeSeconds(value);
            setCrossfadeDurationPreference(value);
          }}
        />
      </Section>

      <Section
        title="Visualizer"
        description="Control the look and motion of the full-screen visualizer."
      >
        <ToggleRow
          label="Visualizer enabled"
          description="Show the visualizer behind the expanded player."
          checked={visualizerEnabled}
          onChange={(value) => {
            setVisualizerEnabled(value);
            setVisualizerEnabledPreference(value);
          }}
        />
        <ToggleRow
          label="Use album palette"
          description="Tint accents and lyrics using colors extracted from the current cover art."
          checked={useAlbumPalette}
          onChange={(value) => {
            setUseAlbumPalette(value);
            setUseAlbumPalettePreference(value);
          }}
        />
        <RangeRow
          label="Ring separation"
          value={vizSettings.separation}
          min={0.05}
          max={0.4}
          step={0.01}
          displayValue={vizSettings.separation.toFixed(2)}
          onChange={(value) => updateVizSettings({ separation: value })}
        />
        <RangeRow
          label="Glow"
          value={vizSettings.glow}
          min={1}
          max={12}
          step={0.5}
          displayValue={vizSettings.glow.toFixed(1)}
          onChange={(value) => updateVizSettings({ glow: value })}
        />
        <RangeRow
          label="Scale"
          value={vizSettings.scale}
          min={0.8}
          max={2.2}
          step={0.05}
          displayValue={vizSettings.scale.toFixed(2)}
          onChange={(value) => updateVizSettings({ scale: value })}
        />
        <RangeRow
          label="Persistence"
          value={vizSettings.persistence}
          min={0.2}
          max={0.95}
          step={0.05}
          displayValue={vizSettings.persistence.toFixed(2)}
          onChange={(value) => updateVizSettings({ persistence: value })}
        />
        <RangeRow
          label="Detail"
          description="Higher values create more detail at a small GPU cost."
          value={vizSettings.octaves}
          min={1}
          max={4}
          step={1}
          displayValue={String(vizSettings.octaves)}
          onChange={(value) => updateVizSettings({ octaves: Math.round(value) })}
        />
        <div className="pt-2">
          <button
            type="button"
            onClick={resetVisualizer}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/75 transition-colors hover:bg-white/5 hover:text-white"
          >
            <RotateCcw size={15} />
            Restore visualizer defaults
          </button>
        </div>
      </Section>
    </div>
  );
}
