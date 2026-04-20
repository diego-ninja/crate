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
  children,
  active = false,
  onClick,
  disabled = false,
  icon: Icon,
  className = "",
}: CratePillProps) {
  const base = `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition ${className}`;
  const color = active
    ? "border-cyan-400/40 bg-cyan-400/12 text-cyan-200"
    : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white";
  const dis = disabled ? "cursor-not-allowed opacity-40" : "";

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
  children,
  active = false,
  icon: Icon,
  className = "",
}: CrateChipProps) {
  const color = active
    ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
    : "border-white/10 bg-white/[0.03] text-white/55";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${color} ${className}`}>
      {Icon && <Icon size={10} />}
      {children}
    </span>
  );
});
