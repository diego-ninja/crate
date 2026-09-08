import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowDownToLine, Loader2 } from "@crate/ui/icons";

import {
  useRemoteImport,
  type RemoteImportStatus,
} from "@/hooks/useRemoteImport";

interface RemoteImportActionProps {
  globalAlbumUid: string;
  estimatedBytes?: number | null;
  sourceName?: string | null;
}

function formatBytes(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function RemoteImportCompleted() {
  const { t } = useTranslation();
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-accent-action">
      <ArrowDownToLine size={16} />
      {t("album.remoteImport.completed")}
    </p>
  );
}

function RemoteImportApprovalStatus({
  status,
}: {
  status: RemoteImportStatus;
}) {
  const { t } = useTranslation();
  return (
    <p className="text-sm text-text-muted" role="status">
      {status === "approved"
        ? t("album.remoteImport.approved")
        : t("album.remoteImport.awaitingApproval")}
    </p>
  );
}

function RemoteImportProgressStatus({
  status,
  progress,
}: {
  status: RemoteImportStatus;
  progress: number | null;
}) {
  const { t } = useTranslation();
  return (
    <p
      className="inline-flex items-center gap-2 text-sm text-text-muted"
      role="status"
    >
      <Loader2 size={16} className="animate-spin" />
      {status === "downloading" && progress != null
        ? t("album.remoteImport.downloading", { progress })
        : t(`album.remoteImport.${status}`)}
    </p>
  );
}

function terminalMessage(
  status: RemoteImportStatus,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (status === "cancelled") return t("album.remoteImport.cancelled");
  if (status === "offline") return t("album.remoteImport.offline");
  if (status === "forbidden") return t("album.remoteImport.forbidden");
  if (status === "failed" || status === "cleaned") {
    return t("album.remoteImport.failed");
  }
  return null;
}

function RemoteImportTerminalStatus({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
      <span className="inline-flex items-center gap-2 text-text-muted">
        <AlertCircle size={16} /> {message}
      </span>
      <button
        type="button"
        className="font-semibold text-accent-action hover:text-accent-action/80"
        onClick={onRetry}
      >
        {t("album.remoteImport.retry")}
      </button>
    </div>
  );
}

function RemoteImportConfirmation({
  estimatedSize,
  sourceName,
  onConfirm,
  onCancel,
}: {
  estimatedSize: string | null;
  sourceName?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="max-w-xl rounded-xl border border-border-quiet bg-text-primary/[0.04] p-4"
      role="group"
      aria-label={t("album.remoteImport.confirmTitle")}
    >
      <p className="text-sm font-semibold text-text-primary">
        {t("album.remoteImport.confirmTitle")}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {t("album.remoteImport.confirmBody", {
          source: sourceName || t("album.remoteImport.remoteNode"),
          size: estimatedSize || t("album.remoteImport.unknownSize"),
        })}
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          className="rounded-full bg-accent-action px-4 py-2 text-sm font-semibold text-accent-action-foreground"
          onClick={onConfirm}
        >
          {t("album.remoteImport.confirm")}
        </button>
        <button
          type="button"
          className="rounded-full bg-text-primary/[0.08] px-4 py-2 text-sm font-semibold text-text-primary"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

function RemoteImportRequestButton({
  requesting,
  onRequest,
}: {
  requesting: boolean;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex h-11 items-center gap-2 rounded-full border border-accent-action/25 bg-accent-action/10 px-5 text-sm font-semibold text-accent-action transition-colors hover:bg-accent-action/15 disabled:cursor-wait disabled:opacity-60"
      disabled={requesting}
      onClick={onRequest}
    >
      {requesting ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <ArrowDownToLine size={16} />
      )}
      {requesting
        ? t("album.remoteImport.requesting")
        : t("album.remoteImport.action")}
    </button>
  );
}

export function RemoteImportAction({
  globalAlbumUid,
  estimatedBytes,
  sourceName,
}: RemoteImportActionProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const { status, progress, start, reset } = useRemoteImport(globalAlbumUid);
  const estimatedSize = formatBytes(estimatedBytes);

  if (status === "completed") return <RemoteImportCompleted />;
  if (["awaiting_approval", "requested", "approved"].includes(status)) {
    return <RemoteImportApprovalStatus status={status} />;
  }
  if (["reserving", "downloading", "verifying", "importing"].includes(status)) {
    return <RemoteImportProgressStatus status={status} progress={progress} />;
  }

  const message = terminalMessage(status, t);
  if (message && !confirming) {
    return (
      <RemoteImportTerminalStatus
        message={message}
        onRetry={() => {
          reset();
          setConfirming(true);
        }}
      />
    );
  }
  if (confirming) {
    return (
      <RemoteImportConfirmation
        estimatedSize={estimatedSize}
        sourceName={sourceName}
        onConfirm={() => {
          setConfirming(false);
          void start();
        }}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <RemoteImportRequestButton
      requesting={status === "requesting"}
      onRequest={() => setConfirming(true)}
    />
  );
}
