import { createPreloadableLazy } from "@/lib/create-preloadable-lazy";

const queuePanel = createPreloadableLazy(
  () => import("@/components/player/QueuePanel"),
  (module) => module.QueuePanel,
);

const lyricsPanel = createPreloadableLazy(
  () => import("@/components/player/LyricsPanel"),
  (module) => module.LyricsPanel,
);

const equalizerPopover = createPreloadableLazy(
  () => import("@/components/player/EqualizerPopover"),
  (module) => module.EqualizerPopover,
);

const extendedPlayer = createPreloadableLazy(
  () => import("@/components/player/ExtendedPlayer"),
  (module) => module.ExtendedPlayer,
);

const fullscreenPlayer = createPreloadableLazy(
  () => import("@/components/player/FullscreenPlayer"),
  (module) => module.FullscreenPlayer,
);

export const LazyQueuePanel = queuePanel.Component;
export const LazyLyricsPanel = lyricsPanel.Component;
export const LazyEqualizerPopover = equalizerPopover.Component;
export const LazyExtendedPlayer = extendedPlayer.Component;
export const LazyFullscreenPlayer = fullscreenPlayer.Component;

export function preloadQueuePanel() {
  return queuePanel.preload();
}

export function preloadLyricsPanel() {
  return lyricsPanel.preload();
}

export function preloadEqualizerPopover() {
  return equalizerPopover.preload();
}

export function preloadExtendedPlayer() {
  return extendedPlayer.preload();
}

export function preloadFullscreenPlayer() {
  return fullscreenPlayer.preload();
}

export function preloadDesktopPlayerSurfaces() {
  return Promise.all([
    queuePanel.preload(),
    lyricsPanel.preload(),
    equalizerPopover.preload(),
    extendedPlayer.preload(),
  ]);
}
