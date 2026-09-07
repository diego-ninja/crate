import { type ComponentProps } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@crate/ui/shadcn/button";
import { cn } from "@/lib/utils";

interface AIButtonProps
  extends Omit<ComponentProps<typeof Button>, "variant" | "size"> {
  loading?: boolean;
}

export function AIButton({
  loading,
  children,
  className,
  disabled,
  ...props
}: AIButtonProps) {
  return (
    <div className="relative inline-flex">
      {/* Glow pulse behind the button */}
      <div
        className={cn(
          "absolute -inset-[3px] rounded-md bg-gradient-to-r from-primary/45 via-cyan-200/25 to-primary/45 opacity-65 blur-md",
          loading
            ? "animate-pulse"
            : "animate-[aiGlow_3s_ease-in-out_infinite]",
          disabled && "opacity-0",
        )}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || loading}
        className={cn(
          "relative border-primary/45 bg-black/85 text-primary shadow-[0_0_18px_rgba(34,211,238,0.12)] hover:border-primary/70 hover:bg-primary/15 hover:text-primary",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 size={13} className="mr-1.5 animate-spin" />
        ) : (
          <Sparkles size={13} className="mr-1.5" />
        )}
        {children}
      </Button>
    </div>
  );
}
