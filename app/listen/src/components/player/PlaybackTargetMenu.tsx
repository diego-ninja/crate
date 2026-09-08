import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@crate/ui/lib/cn";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { toast } from "sonner";

import {
  loadPlaybackTargetGroups,
  selectPlaybackTarget,
  type PlaybackTarget,
  type PlaybackTargetContext,
  type PlaybackTargetGroup,
} from "@/lib/playback-targets";
import {
  CONNECT_ENABLED_EVENT,
  CONNECT_SESSION_EVENT,
} from "@/lib/crate-connect";
import { onNativeOutputRouteChanged } from "@/lib/native-output-router";

import { PlaybackTargetButton } from "./PlaybackTargetButton";
import { PlaybackTargetPopover } from "./PlaybackTargetPopover";

interface PlaybackTargetMenuProps {
  className?: string;
  onOverlayChange?: (open: boolean) => void;
  targetContext?: PlaybackTargetContext;
}

export function PlaybackTargetMenu({
  className,
  onOverlayChange,
  targetContext,
}: PlaybackTargetMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<PlaybackTargetGroup[]>([]);
  const [popoverPosition, setPopoverPosition] = useState<{
    right: number;
    bottom: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const targetContextRef = useRef(targetContext);
  useEffect(() => {
    targetContextRef.current = targetContext;
  }, [targetContext]);
  const targetTrackId = targetContext?.currentTrack?.id;
  const activeConnectInstanceId = targetContext?.connect?.activeInstanceId;
  const connectedInstanceCount =
    targetContext?.connect?.connectedInstances.length ?? 0;
  const activeTarget = useMemo(
    () =>
      groups.flatMap((group) => group.targets).find((target) => target.active),
    [groups],
  );

  const refreshTargets = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    loadPlaybackTargetGroups(targetContextRef.current)
      .then((nextGroups) => {
        if (!cancelled) setGroups(nextGroups);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshTargetsCleanupRef = useRef<(() => void) | null>(null);
  const runRefreshTargets = useCallback(() => {
    refreshTargetsCleanupRef.current?.();
    refreshTargetsCleanupRef.current = refreshTargets();
  }, [refreshTargets]);

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setPopoverPosition({
      right: Math.max(8, window.innerWidth - rect.right),
      bottom: window.innerHeight - rect.top + 8,
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPopoverPosition(null);
    onOverlayChange?.(false);
  }, [onOverlayChange]);

  useDismissibleLayer({
    active: open,
    refs: [buttonRef, popoverRef],
    onDismiss: close,
  });

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    runRefreshTargets();
    return () => {
      refreshTargetsCleanupRef.current?.();
      refreshTargetsCleanupRef.current = null;
    };
  }, [
    activeConnectInstanceId,
    connectedInstanceCount,
    runRefreshTargets,
    targetTrackId,
  ]);

  useEffect(() => {
    window.addEventListener(CONNECT_SESSION_EVENT, runRefreshTargets);
    window.addEventListener(CONNECT_ENABLED_EVENT, runRefreshTargets);
    window.addEventListener("focus", runRefreshTargets);
    return () => {
      window.removeEventListener(CONNECT_SESSION_EVENT, runRefreshTargets);
      window.removeEventListener(CONNECT_ENABLED_EVENT, runRefreshTargets);
      window.removeEventListener("focus", runRefreshTargets);
    };
  }, [runRefreshTargets]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void onNativeOutputRouteChanged(() => {
      runRefreshTargets();
    }).then((nextCleanup) => {
      if (disposed) {
        nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [open, runRefreshTargets]);

  const handleTarget = useCallback(
    async (target: PlaybackTarget) => {
      if (!target.available) {
        toast.info(
          target.unavailableReason || t("player.output.unavailableToast"),
        );
        return;
      }
      const result = await selectPlaybackTarget(
        target,
        targetContextRef.current,
      );
      if (!result.ok && result.message) {
        toast.info(result.message);
        return;
      }
      close();
    },
    [close, t],
  );

  const toggle = useCallback(() => {
    const nextOpen = !open;
    if (nextOpen) updatePopoverPosition();
    setOpen(nextOpen);
    onOverlayChange?.(nextOpen);
  }, [onOverlayChange, open, updatePopoverPosition]);

  return (
    <div className={cn("flex items-center", className)}>
      <PlaybackTargetButton
        buttonRef={buttonRef}
        open={open}
        activeTarget={activeTarget}
        onToggle={toggle}
      />

      {open && popoverPosition
        ? createPortal(
            <PlaybackTargetPopover
              popoverRef={popoverRef}
              position={popoverPosition}
              loading={loading}
              groups={groups}
              onTarget={(target) => void handleTarget(target)}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
