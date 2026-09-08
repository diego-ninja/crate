import { useEffect } from "react";
import {
  preloadFullscreenPlayer,
  preloadQueuePanel,
} from "@/components/player/lazy-player-surfaces";
import type { PlaybackDeliveryPreference } from "@/lib/player-playback-prefs";

type BooleanSetter = (value: boolean) => void;

export function usePlayerBarEqualizerEffect(
  allowEqualizer: boolean,
  setShowEqualizer: BooleanSetter,
) {
  useEffect(() => {
    if (!allowEqualizer) setShowEqualizer(false);
  }, [allowEqualizer, setShowEqualizer]);
}

export function usePlayerBarNativeBackEffect({
  extendedOpen,
  fsOpen,
  hasFloatingOverlayOpen,
  setExtendedOpen,
  setHasFloatingOverlayOpen,
  setShowEqualizer,
  setShowLyrics,
  setShowQueue,
  showEqualizer,
  showLyrics,
  showQueue,
}: {
  extendedOpen: boolean;
  fsOpen: boolean;
  hasFloatingOverlayOpen: boolean;
  setExtendedOpen: BooleanSetter;
  setHasFloatingOverlayOpen: BooleanSetter;
  setShowEqualizer: BooleanSetter;
  setShowLyrics: BooleanSetter;
  setShowQueue: BooleanSetter;
  showEqualizer: boolean;
  showLyrics: boolean;
  showQueue: boolean;
}) {
  useEffect(() => {
    const handleNativeBack = (event: Event) => {
      if (fsOpen) return;
      if (
        !hasFloatingOverlayOpen &&
        !showQueue &&
        !showLyrics &&
        !showEqualizer &&
        !extendedOpen
      ) {
        return;
      }
      event.preventDefault();
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
      setExtendedOpen(false);
    };
    window.addEventListener("crate:native-back", handleNativeBack);
    return () =>
      window.removeEventListener("crate:native-back", handleNativeBack);
  }, [
    extendedOpen,
    fsOpen,
    hasFloatingOverlayOpen,
    setExtendedOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
    showEqualizer,
    showLyrics,
    showQueue,
  ]);
}

export function usePlayerBarMobileSurfaceEffect({
  isDesktop,
  setExtendedOpen,
  setFsOpen,
  setHasFloatingOverlayOpen,
  setShowEqualizer,
  setShowLyrics,
  setShowQueue,
}: {
  isDesktop: boolean;
  setExtendedOpen: BooleanSetter;
  setFsOpen: BooleanSetter;
  setHasFloatingOverlayOpen: BooleanSetter;
  setShowEqualizer: BooleanSetter;
  setShowLyrics: BooleanSetter;
  setShowQueue: BooleanSetter;
}) {
  useEffect(() => {
    if (isDesktop) return;

    const closeMobileSurfaces = (event?: Event) => {
      if (
        event?.type === "visibilitychange" &&
        typeof document !== "undefined" &&
        document.visibilityState !== "hidden"
      ) {
        return;
      }
      setFsOpen(false);
      setExtendedOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
      setHasFloatingOverlayOpen(false);
    };

    window.addEventListener(
      "crate:app-paused",
      closeMobileSurfaces as EventListener,
    );
    document.addEventListener("visibilitychange", closeMobileSurfaces);
    return () => {
      window.removeEventListener(
        "crate:app-paused",
        closeMobileSurfaces as EventListener,
      );
      document.removeEventListener("visibilitychange", closeMobileSurfaces);
    };
  }, [
    isDesktop,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
  ]);
}

export function usePlayerBarRemoteSurfaceEffect({
  isRemoteConnectActive,
  setExtendedOpen,
  setFsOpen,
  setHasFloatingOverlayOpen,
  setShowEqualizer,
  setShowLyrics,
}: {
  isRemoteConnectActive: boolean;
  setExtendedOpen: BooleanSetter;
  setFsOpen: BooleanSetter;
  setHasFloatingOverlayOpen: BooleanSetter;
  setShowEqualizer: BooleanSetter;
  setShowLyrics: BooleanSetter;
}) {
  useEffect(() => {
    if (!isRemoteConnectActive) return;
    setFsOpen(false);
    setExtendedOpen(false);
    setShowLyrics(false);
    setShowEqualizer(false);
    setHasFloatingOverlayOpen(false);
  }, [
    isRemoteConnectActive,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
  ]);
}

export function usePlayerBarPlaybackPreferenceEffect({
  eventName,
  setPlaybackDeliveryPolicy,
  getPreference,
}: {
  eventName: string;
  setPlaybackDeliveryPolicy: (value: PlaybackDeliveryPreference) => void;
  getPreference: () => PlaybackDeliveryPreference;
}) {
  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const nextPolicy = (
        event as CustomEvent<{
          playbackDeliveryPolicy?: PlaybackDeliveryPreference;
        }>
      ).detail?.playbackDeliveryPolicy;
      setPlaybackDeliveryPolicy(nextPolicy ?? getPreference());
    };
    window.addEventListener(eventName, onPrefsChanged as EventListener);
    return () => {
      window.removeEventListener(eventName, onPrefsChanged as EventListener);
    };
  }, [eventName, getPreference, setPlaybackDeliveryPolicy]);
}

export function usePlayerBarExternalSurfaceEffects({
  currentTrackAvailable,
  displayTrackAvailable,
  fsOpen,
  isDesktop,
  setFsOpen,
  setShowEqualizer,
  setShowLyrics,
  setShowQueue,
  setShouldRenderFullscreenPlayer,
  setShouldRenderQueuePanel,
}: {
  currentTrackAvailable: boolean;
  displayTrackAvailable: boolean;
  fsOpen: boolean;
  isDesktop: boolean;
  setFsOpen: BooleanSetter;
  setShowEqualizer: BooleanSetter;
  setShowLyrics: BooleanSetter;
  setShowQueue: BooleanSetter;
  setShouldRenderFullscreenPlayer: BooleanSetter;
  setShouldRenderQueuePanel: BooleanSetter;
}) {
  useEffect(() => {
    if (!isDesktop && fsOpen) {
      setShouldRenderFullscreenPlayer(true);
      void preloadFullscreenPlayer();
    }
  }, [fsOpen, isDesktop, setShouldRenderFullscreenPlayer]);

  useEffect(() => {
    const handleOpenFullscreen = () => {
      if (isDesktop || !currentTrackAvailable) return;
      setShouldRenderFullscreenPlayer(true);
      void preloadFullscreenPlayer();
      setFsOpen(true);
    };
    window.addEventListener(
      "crate:open-fullscreen-player",
      handleOpenFullscreen,
    );
    return () => {
      window.removeEventListener(
        "crate:open-fullscreen-player",
        handleOpenFullscreen,
      );
    };
  }, [
    currentTrackAvailable,
    isDesktop,
    setFsOpen,
    setShouldRenderFullscreenPlayer,
  ]);

  useEffect(() => {
    const handleOpenQueue = () => {
      if (!displayTrackAvailable) return;
      setShouldRenderQueuePanel(true);
      void preloadQueuePanel();
      setShowQueue(true);
      setShowLyrics(false);
      setShowEqualizer(false);
    };
    window.addEventListener("crate:open-player-queue", handleOpenQueue);
    return () => {
      window.removeEventListener("crate:open-player-queue", handleOpenQueue);
    };
  }, [
    displayTrackAvailable,
    setShouldRenderQueuePanel,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
  ]);
}

export function usePlayerBarLongPressEffect(
  clearCoverLongPressTimer: () => void,
) {
  useEffect(() => clearCoverLongPressTimer, [clearCoverLongPressTimer]);
}
