import { isAndroidNative, isIosNative, isNative, platform } from "@/lib/capacitor-runtime";

export type ListenDeviceType = "android" | "ipad" | "iphone" | "web";
export type ListenAppPlatform = "listen-android" | "listen-ios" | "listen-web";

const DEVICE_FINGERPRINT_KEY = "listen-device-fingerprint";

export function isIpadRuntime(): boolean {
  if (platform !== "ios") return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const navPlatform = navigator.platform || "";
  return /iPad/i.test(ua) || (navPlatform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function getListenDeviceType(): ListenDeviceType {
  if (isAndroidNative) return "android";
  if (isIosNative) return isIpadRuntime() ? "ipad" : "iphone";
  return "web";
}

export function getListenAppPlatform(): ListenAppPlatform {
  if (!isNative) return "listen-web";
  if (platform === "android") return "listen-android";
  if (platform === "ios") return "listen-ios";
  return "listen-web";
}

export function getListenDeviceLabel(): string {
  switch (getListenDeviceType()) {
    case "android":
      return "Android (Listen)";
    case "ipad":
      return "iPad (Listen)";
    case "iphone":
      return "iPhone (Listen)";
    default:
      return "Web (Listen)";
  }
}

function generateDeviceFingerprint(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `listen:${crypto.randomUUID()}`;
  }
  return `listen:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getListenDeviceFingerprint(): string {
  try {
    const existing = localStorage.getItem(DEVICE_FINGERPRINT_KEY);
    if (existing) return existing;
    const next = generateDeviceFingerprint();
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, next);
    return next;
  } catch {
    return `${getListenAppPlatform()}:${getListenDeviceLabel()}`;
  }
}
