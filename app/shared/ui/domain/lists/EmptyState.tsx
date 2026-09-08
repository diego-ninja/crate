import type { CrateIcon } from "@crate/ui/icons";
import { Music } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export interface EmptyStateProps {
  title?: string;
  message?: string;
  icon?: CrateIcon;
  className?: string;
}

export function EmptyState({
  title,
  message,
  icon: Icon = Music,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
      data-testid="empty-state"
    >
      <Icon size={48} className="text-text-primary/25" />
      {title ? (
        <div className="text-lg font-semibold text-text-primary/90">
          {title}
        </div>
      ) : null}
      {message ? (
        <div className="max-w-xs text-sm text-text-primary/50">{message}</div>
      ) : null}
    </div>
  );
}
