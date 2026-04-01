import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  setInfinitePlaybackPreference,
  setCrossfadeDurationPreference,
  setSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsPreference,
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

function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`space-y-2 ${disabled ? "opacity-50" : ""}`}>
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
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-400 disabled:cursor-not-allowed"
      />
    </div>
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
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-cyan-400/50 bg-cyan-400/25"
            : "border-white/10 bg-white/[0.03]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export function Settings() {
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fine-tune playback behavior for this device.
        </p>
      </div>

      <Section
        title="Playback"
        description="These preferences shape how the player behaves between tracks."
      >
        <ToggleRow
          label="Infinite playback"
          description="When an album or playlist ends, keep the session going with context-aware continuation."
          checked={infinitePlaybackEnabled}
          onChange={(value) => {
            setInfinitePlaybackEnabled(value);
            setInfinitePlaybackPreference(value);
          }}
        />
        <RangeRow
          label="Crossfade"
          description="Set a preferred crossfade length for compatible transitions. Continuous album playback should still favor the most seamless handoff available."
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
        <ToggleRow
          label="Smart playlist suggestions"
          description="While listening to a playlist, occasionally slip in one contextual recommendation without changing the playlist itself."
          checked={smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsEnabled(value);
            setSmartPlaylistSuggestionsPreference(value);
          }}
        />
        <RangeRow
          label="Suggestion cadence"
          description="How many original playlist tracks should play before a suggested track can be inserted."
          value={smartPlaylistSuggestionsCadence}
          min={2}
          max={10}
          step={1}
          displayValue={`Every ${smartPlaylistSuggestionsCadence} tracks`}
          disabled={!smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsCadence(value);
            setSmartPlaylistSuggestionsCadencePreference(value);
          }}
        />
      </Section>
    </div>
  );
}
