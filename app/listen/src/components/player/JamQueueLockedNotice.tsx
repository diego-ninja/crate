import { Lock } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

export function JamQueueLockedNotice() {
  const { t } = useTranslation();

  return (
    <div className="mx-3 my-2 flex items-start gap-2 rounded-lg border border-accent-action/20 bg-accent-action/10 px-3 py-2 text-accent-action">
      <Lock size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold">
          {t("player.queue.jamReadonlyTitle")}
        </p>
        <p className="text-xs leading-4 text-text-muted">
          {t("player.queue.jamReadonlyDescription")}
        </p>
      </div>
    </div>
  );
}
