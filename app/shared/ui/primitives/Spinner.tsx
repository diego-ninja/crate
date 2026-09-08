import { Loader2 } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

interface SpinnerProps {
  className?: string;
  size?: number;
}

export function Spinner({ className, size = 18 }: SpinnerProps) {
  return (
    <Loader2
      size={size}
      className={cn("animate-spin text-text-muted", className)}
    />
  );
}
