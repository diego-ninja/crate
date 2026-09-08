import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ArrowDownToLine, Loader2, RefreshCw, Trash2 } from "@crate/ui/icons";

import { Section } from "@/components/settings/SettingsPrimitives";
import { useOffline } from "@/contexts/OfflineContext";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
  } ${units[unitIndex]}`;
}

export function OfflineSection() {
  const { t } = useTranslation();
  const {
    supported: offlineSupported,
    syncing: offlineSyncing,
    summary: offlineSummary,
    syncAll,
    clearActiveProfile,
  } = useOffline();

  return (
    <Section
      title={t("settings.offline.title")}
      description={t("settings.offline.subtitle")}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("settings.offline.items")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {offlineSummary.itemCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.readyItems", {
              count: offlineSummary.readyItemCount,
            })}
            {offlineSummary.errorItemCount
              ? ` · ${t("settings.offline.needsAttention", {
                  count: offlineSummary.errorItemCount,
                })}`
              : ""}
          </p>
        </div>
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("common.tracks")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {offlineSummary.readyTrackCount}/{offlineSummary.trackCount}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.mirrored")}
          </p>
        </div>
        <div className="rounded-xl border border-border-quiet/10 bg-text-primary/[0.03] p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-text-primary/40">
            {t("settings.offline.storage")}
          </div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {formatBytes(offlineSummary.totalBytes)}
          </div>
          <p className="mt-1 text-xs text-text-muted">
            {t("settings.offline.footprint")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={
            !offlineSupported ||
            offlineSyncing ||
            offlineSummary.itemCount === 0
          }
          onClick={() => {
            void syncAll()
              .then(() => {
                toast.success(t("settings.offline.toasts.synced"));
              })
              .catch((error) => {
                toast.error(
                  (error as Error).message ||
                    t("settings.offline.toasts.syncFailed"),
                );
              });
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-accent-action/30 bg-accent-action/10 px-4 py-2 text-sm font-medium text-accent-action transition-colors hover:bg-accent-action/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {offlineSyncing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {t("settings.offline.syncNow")}
        </button>
        <button
          type="button"
          disabled={
            !offlineSupported ||
            offlineSyncing ||
            offlineSummary.itemCount === 0
          }
          onClick={() => {
            void clearActiveProfile()
              .then(() => {
                toast.success(t("settings.offline.toasts.removed"));
              })
              .catch((error) => {
                toast.error(
                  (error as Error).message ||
                    t("settings.offline.toasts.clearFailed"),
                );
              });
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-state-danger/25 bg-state-danger/10 px-4 py-2 text-sm font-medium text-state-danger transition-colors hover:bg-state-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={16} />
          {t("settings.offline.removeCopies")}
        </button>
      </div>

      <div className="rounded-lg border border-border-quiet/10 bg-text-primary/[0.03] px-4 py-3 text-sm text-text-muted">
        <div className="flex items-start gap-3">
          <ArrowDownToLine size={16} className="mt-0.5 text-text-primary/50" />
          <div>
            {offlineSupported
              ? t("settings.offline.localMirrorDescription")
              : t("settings.offline.unavailable")}
          </div>
        </div>
      </div>
    </Section>
  );
}
