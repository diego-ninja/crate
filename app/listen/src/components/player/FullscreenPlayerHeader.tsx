import type { TFunction } from "i18next";

import type { FSPanel } from "@/components/player/fullscreen-player-types";
import {
  ChevronDown,
  Disc3,
  Info,
  ListMusic,
  Mic3,
  CRATE_ICON_SIZE,
} from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { triggerHaptic } from "@/lib/haptics";

type FullscreenPlayerHeaderProps = {
  activePanel: FSPanel | null;
  onClose: () => void;
  onSelectPanel: (panel: FSPanel | null) => void;
  t: TFunction;
};

export function FullscreenPlayerHeader({
  activePanel,
  onClose,
  onSelectPanel,
  t,
}: FullscreenPlayerHeaderProps) {
  const panelSwitches: {
    id: FSPanel;
    icon: typeof Disc3;
    label: string;
  }[] = [
    { id: "queue", icon: ListMusic, label: t("player.queue") },
    { id: "lyrics", icon: Mic3, label: t("player.lyrics") },
    { id: "info", icon: Info, label: t("player.info") },
  ];

  return (
    <div className="flex items-center gap-2 px-4 pb-3">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("player.close")}
        className="-ml-2 flex size-12 shrink-0 touch-manipulation items-center justify-center text-text-secondary active:text-text-primary"
      >
        <ChevronDown size={28} />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
        {panelSwitches.map(({ id, icon: Icon, label }) => {
          const selected = activePanel === id;
          return (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={selected}
              onClick={() => {
                triggerHaptic("selection");
                onSelectPanel(selected ? null : id);
              }}
              className={cn(
                "group relative flex h-14 min-w-14 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-semibold leading-none transition-[color,filter,transform] active:scale-[0.96]",
                selected
                  ? "text-accent-action drop-shadow-accent-action-icon"
                  : "text-text-muted active:text-text-secondary",
              )}
            >
              <Icon
                size={CRATE_ICON_SIZE.xl}
                className="transition-transform group-active:scale-95"
              />
              <span>{label}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bottom-0 h-0.5 w-4 rounded-full transition-[opacity,box-shadow]",
                  selected
                    ? "bg-accent-action opacity-100 shadow-accent-action-indicator-active"
                    : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
