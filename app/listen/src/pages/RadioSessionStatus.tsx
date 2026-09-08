import { ThumbsDown, ThumbsUp } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import type { RadioMode } from "./radio-model";

export function RadioSessionStatus({
  activeSession,
  activeMode,
  seedLabel,
}: {
  activeSession: string | null;
  activeMode: RadioMode | null;
  seedLabel: string;
}) {
  const { t } = useTranslation();

  if (activeMode === "discovery") {
    return (
      <div className="radio-session-status rounded-xl px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="radio-session-dot size-2 animate-pulse rounded-full" />
          <span className="radio-session-label text-sm font-medium">
            {t("radio.discovery")}
          </span>
          <span className="radio-session-muted text-xs">
            {t("common.playing")}
          </span>
        </div>
      </div>
    );
  }

  if (!activeSession) return null;

  return (
    <div className="radio-session-status rounded-xl px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="radio-session-dot size-2 animate-pulse rounded-full" />
        <span className="radio-session-label text-sm font-medium">
          {seedLabel} Radio
        </span>
        <span className="radio-session-muted text-xs">
          {t("common.playing")}
        </span>
      </div>
      <div className="radio-session-muted mt-1.5 flex items-center gap-1 text-xs">
        <ThumbsUp size={10} /> {t("radio.feedback.likePrefix")}{" "}
        <ThumbsDown size={10} /> {t("radio.feedback.dislikeSuffix")}
      </div>
    </div>
  );
}
