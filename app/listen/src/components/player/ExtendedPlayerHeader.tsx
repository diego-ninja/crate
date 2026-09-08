import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { ChevronDown, Settings, SlidersHorizontal } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import type { TFunction } from "i18next";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { PlayerSurfaceModeSwitch } from "@/components/player/PlayerSurfaceModeSwitch";
import { VisualizerSettingsPanel } from "@/components/player/visualizer/VisualizerSettingsPanel";
import type {
  ExtendedPlayerViewActions,
  ExtendedPlayerViewRefs,
  ExtendedPlayerViewState,
} from "@/components/player/extended-player-view-types";

type ExtendedPlayerHeaderProps = {
  actions: ExtendedPlayerViewActions;
  refs: ExtendedPlayerViewRefs;
  state: ExtendedPlayerViewState;
  t: TFunction;
};

export function ExtendedPlayerHeader({
  actions,
  refs,
  state,
  t,
}: ExtendedPlayerHeaderProps) {
  const showVizSettings =
    state.vizCfg.surfaceMode === "visualizer" && state.showVizSettings;
  const showEqualizer = state.equalizerEnabled && state.showEqualizer;

  return (
    <>
      <div className="z-app-header absolute top-4 right-4 left-4 flex justify-between">
        <button
          type="button"
          onClick={actions.closeWithFeedback}
          aria-label={t("player.close")}
          className="rounded-full bg-surface-control p-2 text-text-secondary backdrop-blur-sm transition-colors hover:bg-surface-control-hover hover:text-text-primary"
        >
          <ChevronDown size={20} />
        </button>
        <div className="flex items-center gap-2">
          <PlayerSurfaceModeSwitch
            mode={state.vizCfg.surfaceMode}
            onChange={actions.onSurfaceModeChange}
          />
          {state.equalizerEnabled ? (
            <button
              type="button"
              ref={refs.equalizerButtonRef}
              onClick={() => {
                actions.setShowVizSettings(false);
                actions.setShowEqualizer((value) => !value);
              }}
              aria-label={t("player.equalizer")}
              className={cn(
                "rounded-full p-2 backdrop-blur-sm transition-colors",
                state.showEqualizer
                  ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                  : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
              )}
            >
              <SlidersHorizontal size={18} />
            </button>
          ) : null}
          <button
            type="button"
            ref={refs.vizSettingsButtonRef}
            onClick={() => actions.setShowVizSettings((value) => !value)}
            aria-label={t("player.visualizerSettings")}
            disabled={state.vizCfg.surfaceMode !== "visualizer"}
            className={cn(
              "rounded-full p-2 backdrop-blur-sm transition-colors",
              state.vizCfg.surfaceMode !== "visualizer"
                ? "bg-surface-icon-control text-text-faint"
                : state.showVizSettings
                  ? "bg-accent-action/18 text-accent-action drop-shadow-accent-action"
                  : "bg-surface-control text-text-secondary hover:bg-surface-control-hover hover:text-text-primary",
            )}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
      {showVizSettings ? (
        <AppPopover
          ref={refs.vizSettingsRef}
          className="absolute top-14 right-4 z-30 w-56 p-4"
        >
          <VisualizerSettingsPanel config={state.vizCfg} />
        </AppPopover>
      ) : null}
      {showEqualizer ? (
        <AppPopover
          ref={refs.equalizerRef}
          className="absolute top-14 right-4 z-30 w-[480px] max-w-[min(480px,calc(100%-2rem))] p-4"
        >
          <EqualizerPanel onClose={() => actions.setShowEqualizer(false)} />
        </AppPopover>
      ) : null}
    </>
  );
}
