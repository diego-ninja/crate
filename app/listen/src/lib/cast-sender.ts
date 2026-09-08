import { registerPlugin } from "@capacitor/core";

import { api } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";
import {
  buildCastTicketRequest,
  buildNativePayload,
  buildWebLoadRequest,
  resolveCastMedia,
  DEFAULT_CAST_TARGET_ID,
} from "./cast-sender-media";
import type {
  CastSenderCapabilities,
  CastSession,
  CastStartPayload,
  CastStartResult,
  CastTicketResponse,
  CastWindow,
  ChromeCastMedia,
  ChromeCastNamespace,
  NativeCastPlugin,
} from "./cast-sender-types";

export type {
  CastSenderCapabilities,
  CastStartPayload,
  CastStartResult,
  CastTicketRequest,
} from "./cast-sender-types";
export { buildCastTicketRequest } from "./cast-sender-media";

const CAST_SENDER_SCRIPT =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

let webCastReady: Promise<boolean> | null = null;
let webCastInitialized = false;
let nativeCast: NativeCastPlugin | null = null;
let nativeCastSessionActive = false;

function getNativeCast(): NativeCastPlugin {
  nativeCast ??= registerPlugin<NativeCastPlugin>("CrateCast");
  return nativeCast;
}

function castWindow(): CastWindow | null {
  if (typeof window === "undefined") return null;
  return window as CastWindow;
}

function isLikelyWebCastBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const hasChromeNamespace = Boolean(castWindow()?.chrome);
  return (
    hasChromeNamespace ||
    (/(Chrome|Chromium|Edg)\//.test(ua) && !/(CriOS|FxiOS)\//.test(ua))
  );
}

function initializeWebCastContext(): boolean {
  const currentWindow = castWindow();
  const castFramework = currentWindow?.cast?.framework;
  const chromeCast = currentWindow?.chrome?.cast;
  if (!castFramework || !chromeCast) return false;
  if (webCastInitialized) return true;

  castFramework.CastContext.getInstance().setOptions({
    receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  webCastInitialized = true;
  return true;
}

function ensureWebCastFramework(): Promise<boolean> {
  const currentWindow = castWindow();
  if (!currentWindow || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  const webWindow = currentWindow;
  if (initializeWebCastContext()) return Promise.resolve(true);
  if (!isLikelyWebCastBrowser()) return Promise.resolve(false);
  if (webCastReady) return webCastReady;

  webCastReady = new Promise((resolve) => {
    let settled = false;
    const timeout = webWindow.setTimeout(() => finish(false), 6000);

    function finish(available: boolean) {
      if (settled) return;
      settled = true;
      webWindow.clearTimeout(timeout);
      resolve(available && initializeWebCastContext());
    }

    const previousCallback = webWindow.__onGCastApiAvailable;
    webWindow.__onGCastApiAvailable = (available) => {
      previousCallback?.(available);
      finish(Boolean(available));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${CAST_SENDER_SCRIPT}"]`,
    );
    if (existingScript) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = CAST_SENDER_SCRIPT;
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  return webCastReady;
}

function currentWebCastSession(): CastSession | null {
  if (!initializeWebCastContext()) return null;
  return (
    castWindow()
      ?.cast?.framework.CastContext.getInstance()
      .getCurrentSession() ?? null
  );
}

function currentWebCastMedia(): ChromeCastMedia | null {
  return currentWebCastSession()?.getMediaSession?.() ?? null;
}

async function requestWebCastSession(): Promise<CastSession | null> {
  if (!initializeWebCastContext()) return null;
  const context = castWindow()?.cast?.framework.CastContext.getInstance();
  const currentSession = context?.getCurrentSession() ?? null;
  if (currentSession) return currentSession;
  return (await context?.requestSession()) ?? null;
}

function castSessionName(session: CastSession | null): string | undefined {
  return session?.getCastDevice?.()?.friendlyName || undefined;
}

function resolveWebCastMediaCommand(
  run: (
    media: ChromeCastMedia,
    chromeCast: ChromeCastNamespace,
    resolve: () => void,
    reject: (error: unknown) => void,
  ) => void,
): Promise<void> {
  const media = currentWebCastMedia();
  const chromeCast = castWindow()?.chrome?.cast;
  if (!media || !chromeCast) {
    return Promise.reject(new Error("No active Cast media session."));
  }
  return new Promise((resolve, reject) => {
    run(media, chromeCast, resolve, reject);
  });
}

async function getNativeCastCapabilities(): Promise<CastSenderCapabilities> {
  try {
    const capabilities = await getNativeCast().getCapabilities();
    return {
      platform: "native",
      visible: capabilities.visible,
      available: capabilities.available,
      activeSession: Boolean(capabilities.activeSession),
      targetName: capabilities.targetName,
      reason: capabilities.reason,
    };
  } catch {
    return {
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
      reason: "Native Cast sender is not installed in this build.",
    };
  }
}

export async function getCastSenderCapabilities(): Promise<CastSenderCapabilities> {
  if (isNative) return getNativeCastCapabilities();
  const available = await ensureWebCastFramework();
  if (!available) {
    return {
      platform: isLikelyWebCastBrowser() ? "web" : "unsupported",
      visible: isLikelyWebCastBrowser(),
      available: false,
      activeSession: false,
      reason:
        "Google Cast sender requires Chrome, Edge, or the native app bridge.",
    };
  }

  const session = currentWebCastSession();
  return {
    platform: "web",
    visible: true,
    available: true,
    activeSession: Boolean(session),
    targetName: castSessionName(session),
  };
}

export function isCastSessionActive(): boolean {
  if (isNative) return nativeCastSessionActive;
  return Boolean(currentWebCastSession());
}

async function castControl(
  command: "pause" | "play" | "seek" | "setVolume" | "stop",
  payload: { currentTime?: number; volume?: number } = {},
): Promise<CastStartResult> {
  if (isNative) {
    try {
      let result: CastStartResult;
      const nativeCastPlugin = getNativeCast();
      if (command === "play") result = await nativeCastPlugin.play();
      else if (command === "pause") result = await nativeCastPlugin.pause();
      else if (command === "seek") {
        result = await nativeCastPlugin.seek({
          currentTime: Math.max(0, payload.currentTime || 0),
        });
      } else if (command === "setVolume") {
        result = await nativeCastPlugin.setVolume({
          volume: Math.max(0, Math.min(1, payload.volume ?? 1)),
        });
      } else result = await nativeCastPlugin.stop();
      nativeCastSessionActive = command === "stop" ? false : result.ok;
      return result;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Cast control failed.",
      };
    }
  }

  try {
    await resolveWebCastMediaCommand((media, chromeCast, resolve, reject) => {
      if (command === "play") {
        media.play(new chromeCast.media.PlayRequest(), resolve, reject);
        return;
      }
      if (command === "pause") {
        media.pause(new chromeCast.media.PauseRequest(), resolve, reject);
        return;
      }
      if (command === "seek") {
        const request = new chromeCast.media.SeekRequest();
        request.currentTime = Math.max(0, payload.currentTime || 0);
        media.seek(request, resolve, reject);
        return;
      }
      if (command === "setVolume") {
        const volume = new chromeCast.Volume(
          Math.max(0, Math.min(1, payload.volume ?? 1)),
          false,
        );
        media.setVolume(
          new chromeCast.media.VolumeRequest(volume),
          resolve,
          reject,
        );
        return;
      }
      media.stop(new chromeCast.media.StopRequest(), resolve, reject);
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Cast control failed.",
    };
  }
}

export function castPlay(): Promise<CastStartResult> {
  return castControl("play");
}

export function castPause(): Promise<CastStartResult> {
  return castControl("pause");
}

export function castSeek(currentTime: number): Promise<CastStartResult> {
  return castControl("seek", { currentTime });
}

export function castSetVolume(volume: number): Promise<CastStartResult> {
  return castControl("setVolume", { volume });
}

export function castStop(): Promise<CastStartResult> {
  return castControl("stop");
}

export async function startCastSession(
  payload: CastStartPayload,
): Promise<CastStartResult> {
  const request = buildCastTicketRequest(
    payload.track,
    payload.targetDeviceId || DEFAULT_CAST_TARGET_ID,
  );
  if (!request) {
    return {
      ok: false,
      message: "This track does not expose a Cast-capable library reference.",
    };
  }

  const capabilities = await getCastSenderCapabilities();
  if (!capabilities.available) {
    return {
      ok: false,
      message: capabilities.reason || "Google Cast is unavailable.",
    };
  }

  try {
    const ticket = await api<CastTicketResponse>(
      "/api/me/cast/tickets",
      "POST",
      request,
    );
    const media = await resolveCastMedia(ticket);

    if (isNative) {
      const result = await getNativeCast().requestSession(
        buildNativePayload(ticket, media, payload),
      );
      nativeCastSessionActive = result.ok;
      return result;
    }

    const session = await requestWebCastSession();
    const chromeCast = castWindow()?.chrome?.cast;
    const loadRequest = chromeCast
      ? buildWebLoadRequest(ticket, media, payload, chromeCast)
      : null;
    if (!session || !loadRequest) {
      return { ok: false, message: "Could not open the Cast device picker." };
    }
    await session.loadMedia(loadRequest);
    nativeCastSessionActive = false;
    const targetName = castSessionName(session);
    return {
      ok: true,
      targetName,
      message: targetName ? `Casting to ${targetName}.` : "Casting started.",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not start Google Cast playback.",
    };
  }
}
