import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { CRATE_ICON_SIZE, MonitorSpeaker, X } from "@crate/ui/icons";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/contexts/AuthContext";
import {
  PlayerActionsContext,
  type PlayerActionsValue,
  type PlayerConnectValue,
} from "@/contexts/player-context";
import { getStoredQueue } from "@/contexts/player-utils";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { transferPlaybackToDevice } from "@/lib/crate-connect";
import { formatCrateDeviceName, getListenDeviceId } from "@/lib/listen-device";
import {
  fetchResumeCandidate,
  isRecentlyPlayingRemote,
  remotePlaybackQueue,
  shouldPromptForRemoteResume,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

function formatPosition(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useLegacyResumeCandidate({
  connectEnabled,
  dismissed,
  transport,
  userId,
}: {
  connectEnabled: boolean;
  dismissed: boolean;
  transport: PlayerConnectValue["transport"];
  userId?: number;
}) {
  const [entry, setEntry] = useState<{
    userId: number;
    candidate: RemotePlaybackState | null;
  } | null>(null);
  const eligible = Boolean(
    userId && connectEnabled && !dismissed && transport !== "ws",
  );

  useEffect(() => {
    if (!eligible || userId == null) return;
    let cancelled = false;
    const localSavedAt = getStoredQueue().savedAt;
    fetchResumeCandidate()
      .then(({ candidate: next }) => {
        if (cancelled) return;
        setEntry({
          userId,
          candidate: shouldPromptForRemoteResume(next, { localSavedAt })
            ? next
            : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eligible, userId]);

  if (!eligible || !entry || entry.userId !== userId) return null;
  return entry.candidate;
}

function activeConnectInstance(connect: PlayerConnectValue) {
  if (connect.transport !== "ws") return null;
  return (
    connect.connectedInstances.find(
      (instance) => instance.instance_id === connect.activeInstanceId,
    ) ?? null
  );
}

function buildContinuePlaybackModel({
  candidate,
  connect,
  connectEnabled,
  dismissed,
}: {
  candidate: RemotePlaybackState | null;
  connect: PlayerConnectValue;
  connectEnabled: boolean;
  dismissed: boolean;
}) {
  const activeInstance = activeConnectInstance(connect);
  const isV2RemoteActive =
    connect.transport === "ws" &&
    Boolean(connect.activeInstanceId) &&
    Boolean(connect.playbackInstanceId) &&
    Boolean(activeInstance) &&
    connect.activeInstanceId !== connect.playbackInstanceId;
  const v2Candidate =
    isV2RemoteActive && connect.isRemoteActive ? connect.remoteState : null;
  const promptState = v2Candidate ?? candidate;
  const queue = promptState ? remotePlaybackQueue(promptState) : [];

  if (!connectEnabled || !promptState || dismissed || queue.length === 0) {
    return null;
  }

  const activeRemote =
    connect.transport === "ws"
      ? isV2RemoteActive
      : isRecentlyPlayingRemote(promptState);
  const label = formatCrateDeviceName({
    app_platform: activeInstance?.app_platform ?? promptState.app_platform,
    device_label: activeInstance?.device_label ?? promptState.device_label,
    device_type: activeInstance?.device_type ?? promptState.device_type,
  });

  return { activeRemote, label, promptState, queue };
}

function useContinuePlaybackAction({
  model,
  playerActions,
  setDismissed,
  t,
}: {
  model: ReturnType<typeof buildContinuePlaybackModel>;
  playerActions: PlayerActionsValue;
  setDismissed: (value: boolean) => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [transferring, setTransferring] = useState(false);
  const { connect, playAll, seek } = playerActions;

  const continueHere = useCallback(async () => {
    if (!model) return;
    const startIndex = Math.max(
      0,
      Math.min(model.promptState.current_index || 0, model.queue.length - 1),
    );
    if (connect.transport === "ws") {
      if (!connect.playbackInstanceId) {
        toast.error(t("player.continue.toasts.connecting"));
        return;
      }
      setTransferring(true);
      const sent = connect.requestTransfer(connect.playbackInstanceId);
      setTransferring(false);
      if (!sent) {
        toast.error(t("player.continue.toasts.transferFailed"));
        return;
      }
      setDismissed(true);
      return;
    }
    if (model.activeRemote) {
      setTransferring(true);
      try {
        await transferPlaybackToDevice(getListenDeviceId(), {
          sourceDeviceId: model.promptState.device_id,
          startPlaying: true,
        });
        setDismissed(true);
      } catch {
        toast.error(t("player.continue.toasts.transferFailed"));
      } finally {
        setTransferring(false);
      }
      return;
    }

    playAll(
      model.queue,
      startIndex,
      model.promptState.play_source || undefined,
    );
    window.setTimeout(() => {
      if (model.promptState.position_ms > 0) {
        seek(model.promptState.position_ms / 1000);
      }
    }, 250);
    setDismissed(true);
  }, [connect, model, playAll, seek, setDismissed, t]);

  return { continueHere, transferring };
}

function ContinuePlaybackBanner({
  model,
  transferring,
  onContinue,
  onDismiss,
}: {
  model: NonNullable<ReturnType<typeof buildContinuePlaybackModel>>;
  transferring: boolean;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { activeRemote, label, promptState } = model;

  return (
    <div className="listen-glass-panel fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-app-modal mx-auto max-w-xl rounded-xl p-3 sm:bottom-24">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-accent-action/25 bg-accent-action/10 p-2 text-text-accent">
          <MonitorSpeaker size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary">
            {activeRemote
              ? t("player.continue.playingOn", { device: label })
              : t("player.continue.fromDevice", { device: label })}
          </div>
          <div className="mt-1 truncate text-xs text-text-muted">
            {promptState.artist ? `${promptState.artist} - ` : ""}
            {promptState.title || t("player.continue.unknownTrack")} -{" "}
            {formatPosition(promptState.position_ms)}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onContinue}
              disabled={transferring}
              className="rounded-lg bg-accent-action px-3 py-1.5 text-xs font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action-hover"
            >
              {transferring
                ? t("player.continue.transferring")
                : activeRemote
                  ? t("player.continue.playHere")
                  : t("player.continue.continue")}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-lg border border-border-quiet px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-text-primary/10 hover:text-text-primary"
            >
              {t("player.continue.notNow")}
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label={t("player.continue.dismiss")}
          onClick={onDismiss}
          className="flex size-9 items-center justify-center text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={CRATE_ICON_SIZE.lg} />
        </button>
      </div>
    </div>
  );
}

export function ContinuePlaybackPrompt() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const playerActions = useContext(PlayerActionsContext);
  if (!playerActions) {
    throw new Error(
      "ContinuePlaybackPrompt must be used within PlayerProvider",
    );
  }
  const connectEnabled = useCrateConnectEnabled();
  const [dismissed, setDismissed] = useState(false);
  const candidate = useLegacyResumeCandidate({
    connectEnabled,
    dismissed,
    transport: playerActions.connect.transport,
    userId: user?.id,
  });
  const model = useMemo(
    () =>
      buildContinuePlaybackModel({
        candidate,
        connect: playerActions.connect,
        connectEnabled,
        dismissed,
      }),
    [candidate, connectEnabled, dismissed, playerActions.connect],
  );
  const action = useContinuePlaybackAction({
    model,
    playerActions,
    setDismissed,
    t,
  });

  if (!model) return null;

  return (
    <ContinuePlaybackBanner
      model={model}
      transferring={action.transferring}
      onContinue={() => void action.continueHere()}
      onDismiss={() => setDismissed(true)}
    />
  );
}
