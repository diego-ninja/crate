import { type ComponentProps } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AIButtonProps extends Omit<ComponentProps<typeof Button>, "variant" | "size"> {
  loading?: boolean;
}

export function AIButton({ loading, children, className, disabled, ...props }: AIButtonProps) {
  return (
    <div className="relative inline-flex">
      {/* Glow pulse behind the button */}
      <div className={cn(
        "absolute -inset-[2px] rounded-md bg-gradient-to-r from-primary/40 via-violet-500/40 to-primary/40 opacity-60 blur-sm",
        loading ? "animate-pulse" : "animate-[aiGlow_3s_ease-in-out_infinite]",
        disabled && "opacity-0",
      )} />
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || loading}
        className={cn(
          "relative border-primary/40 bg-black/80 text-primary hover:bg-primary/15 hover:text-primary text-xs",
          className,
        )}
        {...props}
      >
        {loading ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Sparkles size={13} className="mr-1.5" />}
        {children}
      </Button>
    </div>
  );
}
