import {
  Brain,
  CRATE_ICON_SIZE,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "@crate/ui/icons";
import type { TFunction } from "i18next";

import { useEqualizer } from "@/hooks/use-equalizer";
import { type EqPresetName } from "@/lib/equalizer";
import { EqBands } from "@crate/ui/domain/player/EqBands";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { EqualizerSmartReadout } from "@/components/player/EqualizerSmartReadout";
import {
  AdaptiveFeatureChips,
  GenreResolutionChip,
} from "@/components/player/EqualizerAdaptiveReadouts";

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

type EqualizerState = ReturnType<typeof useEqualizer>;

function EqualizerHeader({
  eq,
  onClose,
  t,
}: {
  eq: EqualizerState;
  onClose?: () => void;
  t: TFunction;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal
          size={CRATE_ICON_SIZE.md}
          className="text-accent-action"
        />
        <h2 className="text-sm font-semibold text-text-primary">
          {t("player.equalizer")}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        <CratePill
          active={eq.smart}
          disabled={!eq.enabled}
          onClick={() => eq.toggleSmart(!eq.smart)}
          icon={Brain}
        >
          {t("player.equalizer.smart.label")}
          {eq.smart && eq.smartStatus === "loading" ? (
            <span className="ml-1 text-xs opacity-60">…</span>
          ) : null}
        </CratePill>
        <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          <input
            type="checkbox"
            checked={eq.enabled}
            onChange={(event) => eq.toggleEnabled(event.target.checked)}
            className=" size-3.5 accent-accent-action"
          />
          {t("common.on")}
        </label>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={t("player.equalizer.close")}
            className="flex size-9 items-center justify-center text-text-muted hover:text-text-primary"
          >
            <X size={CRATE_ICON_SIZE.lg} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function EqualizerModePicker({ eq, t }: { eq: EqualizerState; t: TFunction }) {
  if (eq.smart) {
    return (
      <EqualizerSmartReadout eq={eq.effectiveEq} status={eq.smartStatus} />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-quiet bg-surface-control px-2.5 py-2">
      <span className="mr-1 text-xs uppercase tracking-[0.18em] text-text-subtle">
        {t("player.equalizer.manualHelpers")}
      </span>
      <CratePill
        active={eq.genreAdaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleGenreAdaptive(!eq.genreAdaptive)}
        icon={Tag}
      >
        {t("player.equalizer.genre.label")}
        {eq.genreAdaptive && eq.genreAdaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </CratePill>
      <CratePill
        active={eq.adaptive}
        disabled={!eq.enabled}
        onClick={() => eq.toggleAdaptive(!eq.adaptive)}
        icon={Sparkles}
      >
        {t("player.equalizer.adaptive.label")}
        {eq.adaptive && eq.adaptiveStatus === "loading" ? (
          <span className="ml-1 text-xs opacity-60">…</span>
        ) : null}
      </CratePill>
    </div>
  );
}

function EqualizerPresetPicker({
  eq,
  manualControlsEnabled,
}: {
  eq: EqualizerState;
  manualControlsEnabled: boolean;
}) {
  return (
    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
      {(Object.keys(PRESET_LABELS) as EqPresetName[]).map((name) => (
        <CratePill
          key={name}
          active={
            eq.preset === name && !eq.smart && !eq.adaptive && !eq.genreAdaptive
          }
          disabled={!manualControlsEnabled}
          onClick={() => eq.applyPreset(name)}
        >
          {PRESET_LABELS[name]}
        </CratePill>
      ))}
    </div>
  );
}

function EqualizerModeBadge({
  adaptive,
  genreAdaptive,
  preset,
  smart,
  t,
}: {
  adaptive: boolean;
  genreAdaptive: boolean;
  preset: EqualizerState["preset"];
  smart: boolean;
  t: TFunction;
}) {
  if (smart) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-xs text-accent-action">
        <Brain size={9} />
        {t("player.equalizer.smartCurve")}
      </span>
    );
  }
  if (adaptive) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-xs text-accent-action">
        <Sparkles size={9} />
        {t("player.equalizer.adaptiveActive")}
      </span>
    );
  }
  if (genreAdaptive) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-accent-action/40 bg-accent-action/10 px-2 py-0.5 text-xs text-accent-action">
        <Tag size={9} />
        {t("player.equalizer.genreActive")}
      </span>
    );
  }
  if (preset === "custom") {
    return (
      <span className="rounded-full border border-border-quiet bg-surface-control px-2 py-0.5 text-xs text-text-secondary">
        {t("player.equalizer.custom")}
      </span>
    );
  }
  return <span />;
}

function EqualizerTrackPresetActions({
  eq,
  hasUserTrackPreset,
  manualControlsEnabled,
  onClear,
  onSave,
  saving,
  t,
}: {
  eq: EqualizerState;
  hasUserTrackPreset: boolean;
  manualControlsEnabled: boolean;
  onClear: () => void;
  onSave: () => void;
  saving: boolean;
  t: TFunction;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {hasUserTrackPreset ? (
        <button
          type="button"
          disabled={saving}
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded-full border border-state-danger/20 bg-state-danger/[0.06] px-2.5 py-0.5 text-xs text-state-danger/80 hover:border-state-danger/35 hover:text-state-danger disabled:cursor-wait disabled:opacity-50"
        >
          <Trash2 size={9} />
          {t("player.equalizer.clearTrackPreset")}
        </button>
      ) : (
        <button
          type="button"
          disabled={!eq.enabled || saving}
          onClick={onSave}
          className="inline-flex items-center gap-1 rounded-full border border-accent-action/20 bg-accent-action/[0.06] px-2.5 py-0.5 text-xs text-accent-action/80 hover:border-accent-action/35 hover:text-accent-action disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Save size={9} />
          {t("player.equalizer.saveForTrack")}
        </button>
      )}
      <button
        type="button"
        disabled={!manualControlsEnabled}
        onClick={eq.resetToFlat}
        className={`inline-flex items-center gap-1 rounded-full border border-border-quiet bg-surface-control px-2.5 py-0.5 text-xs text-text-secondary hover:border-border-interactive hover:text-text-primary ${
          !manualControlsEnabled ? "cursor-not-allowed opacity-40" : ""
        }`}
      >
        <RotateCcw size={9} />
        {t("player.equalizer.reset")}
      </button>
    </div>
  );
}

export function EqualizerPanelView({
  eq,
  onClose,
  onClear,
  onSave,
  saving,
  t,
}: {
  eq: EqualizerState;
  onClose?: () => void;
  onClear: () => void;
  onSave: () => void;
  saving: boolean;
  t: TFunction;
}) {
  const manualControlsEnabled =
    eq.enabled && !eq.smart && !eq.adaptive && !eq.genreAdaptive;
  const hasUserTrackPreset = eq.effectiveEq?.source === "user_track_preset";

  return (
    <div className="flex flex-col gap-4">
      <EqualizerHeader eq={eq} onClose={onClose} t={t} />
      <EqualizerModePicker eq={eq} t={t} />
      <EqualizerPresetPicker
        eq={eq}
        manualControlsEnabled={manualControlsEnabled}
      />
      <div className="flex items-center justify-between">
        <EqualizerModeBadge
          adaptive={eq.adaptive}
          genreAdaptive={eq.genreAdaptive}
          preset={eq.preset}
          smart={eq.smart}
          t={t}
        />
        <EqualizerTrackPresetActions
          eq={eq}
          hasUserTrackPreset={hasUserTrackPreset}
          manualControlsEnabled={manualControlsEnabled}
          onClear={onClear}
          onSave={onSave}
          saving={saving}
          t={t}
        />
      </div>
      {eq.adaptive ? (
        <AdaptiveFeatureChips
          features={eq.adaptiveFeatures}
          status={eq.adaptiveStatus}
        />
      ) : null}
      {eq.genreAdaptive ? (
        <GenreResolutionChip
          genre={eq.trackGenre}
          status={eq.genreAdaptiveStatus}
        />
      ) : null}
      <div className="rounded-xl border border-border-quiet bg-surface-canvas p-3">
        <EqBands
          gains={eq.gains}
          onBandChange={manualControlsEnabled ? eq.updateBand : undefined}
          disabled={!eq.enabled}
        />
      </div>
    </div>
  );
}
