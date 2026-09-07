import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";

export function PlayerSurfaceFallback({
  fullscreen = false,
}: {
  fullscreen?: boolean;
}) {
  const { t } = useTranslation();
  if (!fullscreen) {
    return (
      <div
        className="pointer-events-none fixed inset-x-0 z-app-player-overlay flex justify-end px-4"
        style={{
          bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
        }}
      >
        <div className="listen-player-surface-fallback flex items-center gap-2 rounded-full px-3 py-2 text-xs backdrop-blur-xl">
          <Loader2
            size={CRATE_ICON_SIZE.sm}
            className="animate-spin text-accent-action"
          />
          {t("player.loading")}
        </div>
      </div>
    );
  }
  return (
    <div className="listen-player-fullscreen-scrim fixed inset-0 z-fullscreen-player flex items-center justify-center backdrop-blur-xl">
      <Loader2 size={24} className="animate-spin text-accent-action" />
    </div>
  );
}
