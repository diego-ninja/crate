import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  type RefObject,
} from "react";

import type { FSPanel } from "@/components/player/fullscreen-player-types";
import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";
import { useEscapeKey } from "@crate/ui/lib/use-escape-key";
import {
  getPlayerSurfaceModePreference,
  PLAYER_VIZ_PREFS_EVENT,
  type PlayerSurfaceMode,
} from "@/lib/player-visualizer-prefs";

function getMobileSurfaceModePreference(): PlayerSurfaceMode {
  const mode = getPlayerSurfaceModePreference();
  return mode === "visualizer" ? "cd" : mode;
}

interface UseFullscreenPlayerLifecycleOptions {
  open: boolean;
  onClose: () => void;
  equalizerRef: RefObject<HTMLElement | null>;
  equalizerButtonRef: RefObject<HTMLElement | null>;
}

export function useFullscreenPlayerLifecycle({
  open,
  onClose,
  equalizerRef,
  equalizerButtonRef,
}: UseFullscreenPlayerLifecycleOptions) {
  const [activePanel, setActivePanel] = useState<FSPanel | null>(null);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [surfaceMode, setSurfaceMode] = useState<PlayerSurfaceMode>(
    getMobileSurfaceModePreference,
  );
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  const resetClosedUi = useCallback(() => {
    setActivePanel(null);
    setShowEqualizer(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEscapeKey(visible, (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (showEqualizer) {
      setShowEqualizer(false);
      return;
    }
    if (activePanel !== null) {
      setActivePanel(null);
      return;
    }
    resetClosedUi();
  });

  useEffect(() => {
    const syncSurfaceMode = () =>
      setSurfaceMode(getMobileSurfaceModePreference());
    window.addEventListener("storage", syncSurfaceMode);
    window.addEventListener(
      PLAYER_VIZ_PREFS_EVENT,
      syncSurfaceMode as EventListener,
    );
    return () => {
      window.removeEventListener("storage", syncSurfaceMode);
      window.removeEventListener(
        PLAYER_VIZ_PREFS_EVENT,
        syncSurfaceMode as EventListener,
      );
    };
  }, []);

  useDismissibleLayer({
    active: visible && showEqualizer,
    refs: [equalizerRef, equalizerButtonRef],
    onDismiss: () => setShowEqualizer(false),
    closeOnEscape: false,
  });

  const handleNativeBack = useEffectEvent((event: Event) => {
    event.preventDefault();
    if (showEqualizer) {
      setShowEqualizer(false);
      return;
    }
    if (activePanel !== null) {
      setActivePanel(null);
      return;
    }
    resetClosedUi();
  });

  useEffect(() => {
    if (!visible) return;
    window.addEventListener("crate:native-back", handleNativeBack);
    return () =>
      window.removeEventListener("crate:native-back", handleNativeBack);
  }, [visible]);

  return {
    activePanel,
    animating,
    resetClosedUi,
    setActivePanel,
    setShowEqualizer,
    setSurfaceMode,
    showEqualizer,
    surfaceMode,
    visible,
  };
}
