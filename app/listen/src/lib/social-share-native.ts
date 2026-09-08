import { registerPlugin } from "@capacitor/core";

export interface NativeInstagramStoryResult {
  available?: boolean;
  shared?: boolean;
}

export interface NativeHttpResponse {
  status: number;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface NativeHttpPlugin {
  get(options: {
    url: string;
    responseType: "blob";
    connectTimeout: number;
    readTimeout: number;
  }): Promise<NativeHttpResponse>;
}

interface NativeImageDataResult {
  dataUrl?: string;
}

interface CrateSocialSharePlugin {
  canShareInstagramStory(): Promise<NativeInstagramStoryResult>;
  loadImageDataUrl?(options: { url: string }): Promise<NativeImageDataResult>;
  shareInstagramStory(options: {
    imageDataUrl: string;
    contentUrl: string;
  }): Promise<NativeInstagramStoryResult>;
}

export const nativeSocialShare =
  registerPlugin<CrateSocialSharePlugin>("CrateSocialShare");

let nativeHttpPluginPromise: Promise<NativeHttpPlugin | null> | null = null;

export function getNativeHttpPlugin(): Promise<NativeHttpPlugin | null> {
  nativeHttpPluginPromise ??= import("@capacitor/core")
    .then((module) => {
      const maybeModule = module as unknown as {
        Capacitor?: {
          Plugins?: {
            CapacitorHttp?: NativeHttpPlugin;
          };
        };
        CapacitorHttp?: NativeHttpPlugin;
      };
      return (
        maybeModule.CapacitorHttp ??
        maybeModule.Capacitor?.Plugins?.CapacitorHttp ??
        null
      );
    })
    .catch(() => getWindowCapacitorHttpPlugin());
  return nativeHttpPluginPromise;
}

function getWindowCapacitorHttpPlugin(): NativeHttpPlugin | null {
  if (typeof window === "undefined") return null;
  const maybeWindow = window as unknown as {
    Capacitor?: {
      Plugins?: {
        CapacitorHttp?: NativeHttpPlugin;
      };
    };
  };
  return maybeWindow.Capacitor?.Plugins?.CapacitorHttp ?? null;
}
