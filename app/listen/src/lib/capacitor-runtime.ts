import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export const isAndroidNative = isNative && platform === "android";
export const isIosNative = isNative && platform === "ios";

export function onAppPause(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = App.addListener("pause", callback);
  return () => {
    handle.then((listener) => listener.remove());
  };
}

export function onAppResume(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = App.addListener("resume", callback);
  return () => {
    handle.then((listener) => listener.remove());
  };
}

export async function isOnline(): Promise<boolean> {
  if (!isNative) return navigator.onLine;
  const status = await Network.getStatus();
  return status.connected;
}
