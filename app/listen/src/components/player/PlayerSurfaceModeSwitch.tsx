import { Disc3, Square, WandSparkles } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";
import { cn } from "@crate/ui/lib/cn";

const MODES: { id: PlayerSurfaceMode; icon: typeof Disc3; labelKey: string }[] =
  [
    { id: "cd", icon: Disc3, labelKey: "player.surface.cd" },
    { id: "cover", icon: Square, labelKey: "player.surface.cover" },
    {
      id: "visualizer",
      icon: WandSparkles,
      labelKey: "player.surface.visualizer",
    },
  ];

interface PlayerSurfaceModeSwitchProps {
  allowVisualizer?: boolean;
  className?: string;
  mode: PlayerSurfaceMode;
  onChange: (mode: PlayerSurfaceMode) => void;
  size?: "sm" | "md";
  variant?: "boxed" | "ghost";
}

export function PlayerSurfaceModeSwitch({
  allowVisualizer = true,
  className,
  mode,
  onChange,
  size = "sm",
  variant = "boxed",
}: PlayerSurfaceModeSwitchProps) {
  const { t } = useTranslation();
  const buttonClass = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const iconSize = size === "md" ? 17 : 15;
  const modes = allowVisualizer
    ? MODES
    : MODES.filter((item) => item.id !== "visualizer");

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1",
        variant === "boxed" &&
          "rounded-full border border-border-subtle bg-surface-chrome p-1 backdrop-blur-sm",
        className,
      )}
      role="tablist"
      aria-label={t("player.surface.label")}
    >
      {modes.map(({ id, icon: Icon, labelKey }) => {
        const active = mode === id;
        const label = t(labelKey);
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
                ? "bg-accent-action/18 text-accent-action"
                : variant === "boxed"
                  ? "text-text-muted hover:bg-surface-control hover:text-text-secondary"
                  : "text-text-muted hover:bg-surface-chrome hover:text-text-secondary",
            )}
          >
            <Icon size={iconSize} />
          </button>
        );
      })}
    </div>
  );
}
