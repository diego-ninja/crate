import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Moon } from "@crate/ui/icons";

import { Section } from "@/components/settings/SettingsPrimitives";
import { usePlayerActions } from "@/contexts/PlayerContext";
import {
  cancelSleepTimer,
  formatRemaining,
  startSleepTimer,
  subscribeSleepTimer,
  type SleepTimerMode,
  type SleepTimerState,
} from "@/lib/sleep-timer";

const SLEEP_MODES: { mode: SleepTimerMode; labelKey: string }[] = [
  { mode: "15min", labelKey: "settings.sleep.modes.15min" },
  { mode: "30min", labelKey: "settings.sleep.modes.30min" },
  { mode: "45min", labelKey: "settings.sleep.modes.45min" },
  { mode: "1hr", labelKey: "settings.sleep.modes.1hr" },
  { mode: "end_of_track", labelKey: "settings.sleep.modes.endOfTrack" },
];

export function SleepTimerSection() {
  const { t } = useTranslation();
  const { pause } = usePlayerActions();
  const [timer, setTimer] = useState<SleepTimerState>({
    active: false,
    remainingSeconds: 0,
    mode: null,
  });
  useEffect(() => subscribeSleepTimer(setTimer), []);

  return (
    <Section
      title={t("settings.sleep.title")}
      description={t("settings.sleep.subtitle")}
    >
      <div className="flex flex-wrap gap-2">
        {SLEEP_MODES.map(({ mode, labelKey }) => (
          <button
            key={mode}
            onClick={() => startSleepTimer(mode, pause)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              timer.mode === mode
                ? "bg-accent-action text-accent-action-foreground"
                : "bg-text-primary/5 text-text-primary/60 hover:bg-text-primary/10"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>
      {timer.active && timer.remainingSeconds > 0 ? (
        <div className="flex items-center justify-between rounded-lg border border-accent-action/20 bg-accent-action/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon size={16} className="text-accent-action" />
            <span className="text-sm text-text-primary">
              {t("settings.sleep.pausingIn")}{" "}
              <span className="font-mono font-semibold text-accent-action">
                {formatRemaining(timer.remainingSeconds)}
              </span>
            </span>
          </div>
          <button
            onClick={cancelSleepTimer}
            className="rounded-full bg-state-danger/15 px-3 py-1.5 text-xs font-medium text-state-danger transition-colors hover:bg-state-danger/25"
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : null}
    </Section>
  );
}
