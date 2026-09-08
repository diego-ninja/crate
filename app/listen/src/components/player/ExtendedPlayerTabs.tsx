import type { TFunction } from "i18next";

import { InfoTab } from "@/components/player/extended/InfoTab";
import { LyricsTab } from "@/components/player/extended/LyricsTab";
import { QueueTab } from "@/components/player/extended/QueueTab";
import { SuggestedTab } from "@/components/player/extended/SuggestedTab";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";
import { cn } from "@crate/ui/lib/cn";
import { triggerHaptic } from "@/lib/haptics";

const TABS = [
  { id: "queue", labelKey: "player.queue" },
  { id: "suggested", labelKey: "player.suggested" },
  { id: "lyrics", labelKey: "player.lyrics" },
  { id: "info", labelKey: "player.info" },
] as const;

type ExtendedPlayerTabsProps = {
  actions: ExtendedPlayerViewActions;
  state: ExtendedPlayerViewState;
  t: TFunction;
};

export function ExtendedPlayerTabs({
  actions,
  state,
  t,
}: ExtendedPlayerTabsProps) {
  return (
    <div className="flex w-1/2 flex-col bg-surface-canvas">
      <div className="flex items-center gap-1.5 px-5 pt-5 pb-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              actions.onTabChange(item.id);
            }}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-[0.75rem] font-medium transition-colors",
              state.tab === item.id
                ? "bg-surface-control text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden px-5 pb-5">
        {state.tab === "queue" ? <QueueTab /> : null}
        {state.tab === "suggested" ? <SuggestedTab /> : null}
        {state.tab === "lyrics" ? (
          <LyricsTab useAlbumPalette={state.vizCfg.useAlbumPalette} />
        ) : null}
        {state.tab === "info" ? <InfoTab /> : null}
      </div>
    </div>
  );
}
