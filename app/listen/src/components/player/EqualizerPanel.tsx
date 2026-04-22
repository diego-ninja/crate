import { Activity, SlidersHorizontal, Sparkles, Sun, Tag, Volume2, X, Zap } from "lucide-react";

import type { EqFeatures } from "@/hooks/use-eq-features";
import { useEqualizer } from "@/hooks/use-equalizer";
import type { TrackGenre } from "@/hooks/use-track-genre";
import { type EqPresetName } from "@/lib/equalizer";
import { EqBands } from "@crate-ui/domain/player/EqBands";
import { CratePill, CrateChip } from "@crate-ui/primitives/CrateBadge";

const PRESET_LABELS: Record<EqPresetName, string> = {
  flat: "Flat",
  // General-purpose
  rock: "Rock",
  pop: "Pop",
  jazz: "Jazz",
  classical: "Classical",
  bass_boost: "Bass Boost",
  treble_boost: "Treble Boost",
  vocal: "Vocal",
  electronic: "Electronic",
  acoustic: "Acoustic",
  hip_hop: "Hip-Hop",
  // Underground / heavy
  black_metal: "Black Metal",
  death_metal: "Death Metal",
  thrash: "Thrash",
  doom: "Doom / Sludge",
  hardcore: "Hardcore",
  punk: "Punk",
  progressive: "Progressive",
  shoegaze: "Shoegaze",
  post_rock: "Post-Rock",
  lo_fi: "Indie / Lo-Fi",
};

/**
 * Labeled chip showing a single adaptive feature with its value and a
 * terse semantic classifier (dark/neutral/bright, compressed/moderate/
 * dynamic, etc.). Renders a subtle cyan accent when the value lands in
 * a zone where the adaptive heuristic actually acts on it.
 */
function FeatureChip({
  icon: Icon,
  label,
  value,
  zone,
}: {
  icon: typeof Sun;
  label: string;
  value: string;
  zone: "neutral" | "active";
}) {
  return (
    <CrateChip active={zone === "active"} icon={Icon} className="font-mono tabular-nums">
      <span title={label}>{value}</span>
    </CrateChip>
  );
}

function AdaptiveFeatureChips({
  features,
  status,
}: {
  features: EqFeatures | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  if (status === "loading") {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-muted-foreground">
        Loading analysis…
      </div>
    );
  }
  if (status === "unavailable" || !features) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-muted-foreground">
        No analysis for this track — adaptive is holding flat.
      </div>
    );
  }

  const chips: React.ReactNode[] = [];

  if (typeof features.brightness === "number") {
    const b = features.brightness;
    const active = b < 0.4 || b > 0.55;
    const label =
      b < 0.25 ? "dark" : b < 0.4 ? "warm" : b > 0.7 ? "sharp" : b > 0.55 ? "bright" : "neutral";
    chips.push(
      <FeatureChip
        key="brightness"
        icon={Sun}
        label={`Brightness: ${label}`}
        value={`${Math.round(b * 100)}%`}
        zone={active ? "active" : "neutral"}
      />,
    );
  }

  if (typeof features.loudness === "number") {
    const l = features.loudness;
    const active = l > -10 || l < -20;
    chips.push(
      <FeatureChip
        key="loudness"
        icon={Volume2}
        label={l > -10 ? "Hot master" : l < -20 ? "Very quiet" : "Standard level"}
        value={`${l.toFixed(1)} LUFS`}
        zone={active ? "active" : "neutral"}
      />,
    );
  }

  if (typeof features.dynamicRange === "number") {
    const dr = features.dynamicRange;
    const active = dr > 14 || dr < 6;
    const label = dr > 14 ? "preserved" : dr < 6 ? "compressed" : "moderate";
    chips.push(
      <FeatureChip
        key="dynamic"
        icon={Activity}
        label={`Dynamic range: ${label}`}
        value={`${dr.toFixed(1)} dB`}
        zone={active ? "active" : "neutral"}
      />,
    );
  }

  if (typeof features.energy === "number") {
    const e = features.energy;
    const active = e > 0.7 || e < 0.3;
    chips.push(
      <FeatureChip
        key="energy"
        icon={Zap}
        label={e > 0.7 ? "High energy" : e < 0.3 ? "Low energy" : "Moderate energy"}
        value={`${Math.round(e * 100)}%`}
        zone={active ? "active" : "neutral"}
      />,
    );
  }

  if (chips.length === 0) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-muted-foreground">
        No analysis data for this track.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wider text-white/40">Track</span>
      {chips}
    </div>
  );
}

/**
 * Readout for the genre-adaptive mode. Shows what genre the track
 * reports + how the backend resolved its EQ preset (direct hit vs
 * inherited from an ancestor vs nothing). Keeps the behavior
 * transparent so it doesn't feel like a black box when the curve
 * suddenly changes mid-track.
 */
function GenreResolutionChip({
  genre,
  status,
}: {
  genre: TrackGenre | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}) {
  if (status === "loading") {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-muted-foreground">
        Loading genre…
      </div>
    );
  }
  if (status === "unavailable" || !genre?.primary) {
    return (
      <div className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-muted-foreground">
        No genre data for this track — holding flat.
      </div>
    );
  }

  const primaryName = genre.primary.name;
  const canonical = genre.primary.canonical;
  const preset = genre.preset;

  if (!canonical) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-white/60">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-white/80">{primaryName}</span>
        <span className="opacity-50">— unmapped tag, holding flat.</span>
      </div>
    );
  }

  if (!preset) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[10px] text-white/60">
        <Tag size={10} className="opacity-70" />
        <span className="font-medium capitalize text-white/80">{primaryName}</span>
        <span className="opacity-50">— no preset in taxonomy, holding flat.</span>
      </div>
    );
  }

  const isInherited = preset.source === "inherited";
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1.5 text-[10px] text-cyan-200">
      <Tag size={10} />
      <span className="font-medium capitalize">{primaryName}</span>
      <span className="opacity-70">{isInherited ? "→ inherited" : "→ preset"}</span>
      {isInherited && preset.inheritedFrom ? (
        <span className="font-medium capitalize opacity-80">from {preset.inheritedFrom.name}</span>
      ) : null}
    </div>
  );
}

interface EqualizerPanelProps {
  /** Shown as a header action — optional, typically the close button. */
  onClose?: () => void;
}

/**
 * Reusable EQ panel rendered inside the PlayerBar popover and the
 * FullscreenPlayer overlay. State is owned by useEqualizer — this
 * component is pure presentation.
 */
export function EqualizerPanel({ onClose }: EqualizerPanelProps) {
  const {
    enabled,
    preset,
    gains,
    adaptive,
    genreAdaptive,
    adaptiveStatus,
    adaptiveFeatures,
    genreAdaptiveStatus,
    trackGenre,
    toggleEnabled,
    toggleAdaptive,
    toggleGenreAdaptive,
    applyPreset,
    updateBand,
    resetToFlat,
  } = useEqualizer();

  // Either adaptive mode takes over the band gains, so manual controls
  // (presets, sliders, reset) become read-only to avoid fighting the
  // automatic curve.
  const manualControlsEnabled = enabled && !adaptive && !genreAdaptive;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-cyan-400" />
          <h2 className="text-sm font-semibold text-foreground">Equalizer</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Genre toggle — picks a preset from the track's primary
              genre. Mutually exclusive with Adaptive (the hook enforces
              this). Disabled when the EQ itself is off. */}
          <CratePill
            active={genreAdaptive}
            disabled={!enabled}
            onClick={() => toggleGenreAdaptive(!genreAdaptive)}
            icon={Tag}
          >
            Genre
            {genreAdaptive && genreAdaptiveStatus === "loading" ? (
              <span className="ml-1 text-[9px] opacity-60">…</span>
            ) : null}
          </CratePill>
          <CratePill
            active={adaptive}
            disabled={!enabled}
            onClick={() => toggleAdaptive(!adaptive)}
            icon={Sparkles}
          >
            Adaptive
            {adaptive && adaptiveStatus === "loading" ? (
              <span className="ml-1 text-[9px] opacity-60">…</span>
            ) : null}
          </CratePill>
          <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => toggleEnabled(event.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-400"
            />
            On
          </label>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close equalizer"
              className="rounded-md p-1 text-white/50 hover:bg-white/5 hover:text-white"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {/* Preset picker — compact pill scroller */}
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {(Object.keys(PRESET_LABELS) as EqPresetName[]).map((name) => (
          <CratePill
            key={name}
            active={preset === name && !adaptive && !genreAdaptive}
            disabled={!manualControlsEnabled}
            onClick={() => applyPreset(name)}
          >
            {PRESET_LABELS[name]}
          </CratePill>
        ))}
      </div>

      <div className="flex items-center justify-between">
        {adaptive ? (
          <span className="flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
            <Sparkles size={9} />
            Adaptive active
          </span>
        ) : genreAdaptive ? (
          <span className="flex items-center gap-1 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
            <Tag size={9} />
            Genre active
          </span>
        ) : preset === "custom" ? (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/60">
            Custom
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          disabled={!manualControlsEnabled}
          onClick={resetToFlat}
          className={`rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-[10px] text-white/70 hover:border-white/20 hover:text-foreground ${
            !manualControlsEnabled ? "cursor-not-allowed opacity-40" : ""
          }`}
        >
          Reset
        </button>
      </div>

      {/* Adaptive feature readout — shows the analysis values that drive
          the per-band gains so the current curve doesn't feel like a
          black box. Only visible while adaptive mode is on. */}
      {adaptive ? (
        <AdaptiveFeatureChips features={adaptiveFeatures} status={adaptiveStatus} />
      ) : null}

      {/* Genre resolution readout — shows which genre was detected and
          which preset (if any) got applied. Visible while Genre mode
          is on so the user can see the mapping at a glance. */}
      {genreAdaptive ? (
        <GenreResolutionChip
          genre={trackGenre}
          status={genreAdaptiveStatus}
        />
      ) : null}

      {/* Band sliders */}
      <div className="rounded-xl border border-white/10 bg-black/30 p-3">
        <EqBands
          gains={gains}
          onBandChange={manualControlsEnabled ? updateBand : undefined}
          disabled={!enabled}
        />
      </div>
    </div>
  );
}
