import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { useDismissibleLayer } from "@crate/ui/lib/use-dismissible-layer";

import {
  usePlayerBarEqualizerEffect,
  usePlayerBarExternalSurfaceEffects,
  usePlayerBarMobileSurfaceEffect,
  usePlayerBarNativeBackEffect,
  usePlayerBarRemoteSurfaceEffect,
} from "./usePlayerBarLifecycle";

const FS_OPEN_KEY = "listen-fs-player-open";

type BooleanStateSetter = Dispatch<SetStateAction<boolean>>;

export type PlayerBarSurfaceStateOptions = {
  allowEqualizer: boolean;
  currentTrackAvailable: boolean;
  displayTrackAvailable: boolean;
  isDesktop: boolean;
  isRemoteConnectActive: boolean;
};

export type PlayerBarSurfaceState = {
  closeEqualizer: () => void;
  closeExtendedPlayer: () => void;
  closeFullscreenPlayer: () => void;
  closeLyrics: () => void;
  closeQueue: () => void;
  extendedOpen: boolean;
  fsOpen: boolean;
  hasFloatingOverlayOpen: boolean;
  setExtendedOpen: (open: boolean) => void;
  setFsOpen: (open: boolean) => void;
  setHasFloatingOverlayOpen: BooleanStateSetter;
  setShowEqualizer: BooleanStateSetter;
  setShowLyrics: BooleanStateSetter;
  setShowQueue: BooleanStateSetter;
  setShouldRenderEqualizerPopover: (render: boolean) => void;
  setShouldRenderExtendedPlayer: (render: boolean) => void;
  setShouldRenderFullscreenPlayer: (render: boolean) => void;
  setShouldRenderLyricsPanel: (render: boolean) => void;
  setShouldRenderQueuePanel: (render: boolean) => void;
  showEqualizer: boolean;
  showLyrics: boolean;
  showQueue: boolean;
  shouldRenderEqualizerPopover: boolean;
  shouldRenderExtendedPlayer: boolean;
  shouldRenderFullscreenPlayer: boolean;
  shouldRenderLyricsPanel: boolean;
  shouldRenderQueuePanel: boolean;
};

function getStoredFsOpen(): boolean {
  try {
    return localStorage.getItem(FS_OPEN_KEY) === "true";
  } catch {
    return false;
  }
}

export function usePlayerBarSurfaceState({
  allowEqualizer,
  currentTrackAvailable,
  displayTrackAvailable,
  isDesktop,
  isRemoteConnectActive,
}: PlayerBarSurfaceStateOptions): PlayerBarSurfaceState {
  const [extendedOpen, setExtendedOpen] = useState(false);
  const [fsOpen, setFsOpenRaw] = useState(getStoredFsOpen);
  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showEqualizer, setShowEqualizer] = useState(false);
  const [shouldRenderQueuePanel, setShouldRenderQueuePanel] = useState(false);
  const [shouldRenderLyricsPanel, setShouldRenderLyricsPanel] = useState(false);
  const [shouldRenderEqualizerPopover, setShouldRenderEqualizerPopover] =
    useState(false);
  const [shouldRenderExtendedPlayer, setShouldRenderExtendedPlayer] =
    useState(false);
  const [shouldRenderFullscreenPlayer, setShouldRenderFullscreenPlayer] =
    useState(false);
  const [hasFloatingOverlayOpen, setHasFloatingOverlayOpen] = useState(false);

  const setFsOpen = useCallback((open: boolean) => {
    setFsOpenRaw(open);
    try {
      localStorage.setItem(FS_OPEN_KEY, String(open));
    } catch {
      /* ignore */
    }
  }, []);

  const closeQueue = useCallback(() => setShowQueue(false), []);
  const closeLyrics = useCallback(() => setShowLyrics(false), []);
  const closeEqualizer = useCallback(() => setShowEqualizer(false), []);
  const closeExtendedPlayer = useCallback(() => setExtendedOpen(false), []);
  const closeFullscreenPlayer = useCallback(
    () => setFsOpen(false),
    [setFsOpen],
  );

  usePlayerBarEqualizerEffect(allowEqualizer, setShowEqualizer);

  useDismissibleLayer({
    active: hasFloatingOverlayOpen || showQueue || showLyrics || showEqualizer,
    refs: [],
    onDismiss: () => {
      setHasFloatingOverlayOpen(false);
      setShowQueue(false);
      setShowLyrics(false);
      setShowEqualizer(false);
    },
    closeOnPointerDownOutside: false,
  });

  usePlayerBarNativeBackEffect({
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
  });
  usePlayerBarMobileSurfaceEffect({
    isDesktop,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
  });
  usePlayerBarRemoteSurfaceEffect({
    isRemoteConnectActive,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
  });
  usePlayerBarExternalSurfaceEffects({
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
  });

  return {
    closeEqualizer,
    closeExtendedPlayer,
    closeFullscreenPlayer,
    closeLyrics,
    closeQueue,
    extendedOpen,
    fsOpen,
    hasFloatingOverlayOpen,
    setExtendedOpen,
    setFsOpen,
    setHasFloatingOverlayOpen,
    setShowEqualizer,
    setShowLyrics,
    setShowQueue,
    setShouldRenderEqualizerPopover,
    setShouldRenderExtendedPlayer,
    setShouldRenderFullscreenPlayer,
    setShouldRenderLyricsPanel,
    setShouldRenderQueuePanel,
    showEqualizer,
    showLyrics,
    showQueue,
    shouldRenderEqualizerPopover,
    shouldRenderExtendedPlayer,
    shouldRenderFullscreenPlayer,
    shouldRenderLyricsPanel,
    shouldRenderQueuePanel,
  };
}
