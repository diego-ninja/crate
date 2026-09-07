import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Airplay, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

import type { PlaybackTarget } from "@/lib/playback-targets";

export function PlaybackTargetButton({
  buttonRef,
  open,
  activeTarget,
  onToggle,
}: {
  buttonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  activeTarget: PlaybackTarget | undefined;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const hasRemoteTarget = activeTarget && activeTarget.kind !== "local";

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t("player.output.label")}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md p-1.5 transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action",
        open || hasRemoteTarget
          ? "text-accent-action drop-shadow-accent-action"
          : "text-text-muted",
      )}
    >
      <Airplay size={CRATE_ICON_SIZE.md} />
      {hasRemoteTarget ? (
        <span className="absolute right-0 top-0 size-1.5 rounded-full bg-accent-action shadow-accent-action-indicator-active" />
      ) : null}
    </button>
  );
}
