import { Disc3, Square, WandSparkles } from "lucide-react";

import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import { cn } from "@crate/ui/lib/cn";

const MODES: { id: PlayerSurfaceMode; icon: typeof Disc3; label: string }[] = [
  { id: "cd", icon: Disc3, label: "CD mode" },
  { id: "cover", icon: Square, label: "Cover mode" },
  { id: "visualizer", icon: WandSparkles, label: "Visualizer mode" },
];

interface PlayerSurfaceModeSwitchProps {
  className?: string;
  mode: PlayerSurfaceMode;
  onChange: (mode: PlayerSurfaceMode) => void;
  size?: "sm" | "md";
  variant?: "boxed" | "ghost";
}

export function PlayerSurfaceModeSwitch({
  className,
  mode,
  onChange,
  size = "sm",
  variant = "boxed",
}: PlayerSurfaceModeSwitchProps) {
  const buttonClass = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const iconSize = size === "md" ? 17 : 15;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1",
        variant === "boxed" && "rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur-sm",
        className,
      )}
      role="tablist"
      aria-label="Player display mode"
    >
      {MODES.map(({ id, icon: Icon, label }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(id)}
            className={cn(
              "flex items-center justify-center rounded-full transition-colors",
              buttonClass,
              active
                ? "bg-primary/18 text-primary"
                : variant === "boxed"
                  ? "text-white/40 hover:bg-white/6 hover:text-white/70"
                  : "text-white/40 hover:bg-black/30 hover:text-white/70",
            )}
          >
            <Icon size={iconSize} />
          </button>
        );
      })}
    </div>
  );
}
