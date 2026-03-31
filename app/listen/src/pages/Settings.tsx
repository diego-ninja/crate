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
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);

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
      </Section>
    </div>
  );
}
