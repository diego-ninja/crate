import type { ReactNode } from "react";

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section rounded-[12px] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

export function RangeRow({
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
          <div className="text-sm font-medium text-text-primary">{label}</div>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        <div className="rounded-full border border-border-quiet/10 bg-text-primary/[0.03] px-2.5 py-1 text-xs text-text-primary/70">
          {displayValue ?? value}
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="settings-range w-full disabled:cursor-not-allowed"
      />
    </div>
  );
}

export function ToggleRow({
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
        <div className="text-sm font-medium text-text-primary">{label}</div>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={label}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-accent-action/50 bg-accent-action/25"
            : "border-border-quiet/10 bg-text-primary/[0.03]"
        }`}
      >
        <span
          className={`inline-block size-5 rounded-full bg-text-primary shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
