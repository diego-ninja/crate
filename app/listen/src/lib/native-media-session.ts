import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { isNative } from "@/lib/capacitor-runtime";

export type NativeMediaControl = "play" | "pause" | "next" | "previous" | "seekTo";

export type NativeMediaSessionPayload = {
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
};

type NativeMediaControlEvent = {
  control?: NativeMediaControl;
  position?: number;
};

type CrateMediaSessionPlugin = {
  start(options: NativeMediaSessionPayload): Promise<void>;
  update(options: NativeMediaSessionPayload): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: "control",
    listener: (event: NativeMediaControlEvent) => void,
  ): Promise<PluginListenerHandle>;
};

const nativeMediaSession = registerPlugin<CrateMediaSessionPlugin>("CrateMediaSession");

export async function syncNativeMediaSession(payload: NativeMediaSessionPayload): Promise<void> {
  if (!isNative) return;
  try {
    await nativeMediaSession.update(payload);
  } catch {
    // Native media controls are best-effort and should never interrupt playback.
  }
}

export async function stopNativeMediaSession(): Promise<void> {
  if (!isNative) return;
  try {
    await nativeMediaSession.stop();
  } catch {
    // Ignore native bridge failures during teardown.
  }
}

export async function onNativeMediaControl(
  listener: (event: NativeMediaControlEvent) => void,
): Promise<() => void> {
  if (!isNative) return () => {};
  const handle = await nativeMediaSession.addListener("control", listener);
  return () => {
    void handle.remove();
  };
}
