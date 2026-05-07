import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface NativeMediaSessionAction {
  action: "play" | "pause" | "next" | "previous" | "seek";
  position?: number;
}

interface NativeMediaSessionPlugin {
  setMetadata(options: {
    title: string;
    artist?: string;
    album?: string;
    artworkUrl?: string;
  }): Promise<void>;
  setPlaybackState(options: {
    playing: boolean;
    position: number;
    duration: number;
  }): Promise<void>;
  requestAudioFocus(): Promise<void>;
  clear(): Promise<void>;
  addListener(
    eventName: "mediaSessionAction",
    listenerFunc: (event: NativeMediaSessionAction) => void,
  ): Promise<PluginListenerHandle>;
}

export const CrateMediaSession = registerPlugin<NativeMediaSessionPlugin>("CrateMediaSession");
