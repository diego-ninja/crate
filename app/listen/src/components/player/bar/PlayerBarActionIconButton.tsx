import type { ReactNode } from "react";

type PlayerBarActionIconButtonProps = {
  active?: boolean;
  label: string;
  onClick: () => void;
  onPrepare?: () => void;
  children: ReactNode;
  className?: string;
};

export function PlayerBarActionIconButton({
  active = false,
  label,
  onClick,
  onPrepare,
  children,
  className,
}: PlayerBarActionIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onPrepare}
      onFocus={onPrepare}
      aria-label={label}
      className={`p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
        active ? "text-accent-action" : "text-text-muted"
      } ${className ?? ""}`}
    >
      {children}
    </button>
  );
}
