import { memo, type ComponentType, type ReactNode } from "react";

interface CratePillProps {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ComponentType<{ size: number }>;
  className?: string;
}

export const CratePill = memo(function CratePill({
  children, active = false, onClick, disabled = false, icon: Icon, className = "",
}: CratePillProps) {
  const base = `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${className}`;
  const color = active
    ? "border-[var(--pill-active-border)] bg-[var(--pill-active-bg)] text-[var(--active-text)]"
    : "border-[var(--pill-border)] bg-[var(--pill-bg)] text-[var(--idle-text)] hover:border-[var(--hover-border)] hover:text-foreground";
  const dis = disabled ? "cursor-not-allowed opacity-[var(--disabled-opacity)]" : "";

  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${color} ${dis}`}>
        {Icon && <Icon size={11} />}
        {children}
      </button>
    );
  }
  return (
    <span className={`${base} ${color} ${dis}`}>
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
});

interface CrateChipProps {
  children: ReactNode;
  active?: boolean;
  icon?: ComponentType<{ size: number }>;
  className?: string;
}

export const CrateChip = memo(function CrateChip({
  children, active = false, icon: Icon, className = "",
}: CrateChipProps) {
  const color = active
    ? "border-[var(--chip-active-border)] bg-[var(--chip-active-bg)] text-[var(--active-text)]"
    : "border-[var(--chip-border)] bg-[var(--chip-bg)] text-[var(--idle-text-muted)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${color} ${className}`}>
      {Icon && <Icon size={10} />}
      {children}
    </span>
  );
});
