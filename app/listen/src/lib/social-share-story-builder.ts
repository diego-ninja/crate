import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";
import { recordDevLog } from "@/lib/dev-logs";

import {
  readSocialShareColors,
  type SocialShareColors,
} from "./social-share-colors";
import {
  drawEditorialStoryCard,
  drawStoryArtworkBackground,
  drawStoryBackground,
  drawStoryBrand,
  STORY_HEIGHT,
  STORY_WIDTH,
} from "./social-share-story-canvas";
import { getNativeHttpPlugin, nativeSocialShare } from "./social-share-native";
import type { SharePayload } from "./social-share";

const STORY_ASSET_TIMEOUT_MS = 4500;
const STORY_FONT_TIMEOUT_MS = 1500;
const CRATE_LOGO_URL = "/icons/logo.svg";
const POPPINS_600_URL = new URL(
  "../../../shared/fonts/poppins/poppins-600.woff2",
  import.meta.url,
).href;
const POPPINS_800_URL = new URL(
  "../../../shared/fonts/poppins/poppins-800.woff2",
  import.meta.url,
).href;

export async function buildInstagramStoryCard(
  payload: SharePayload,
): Promise<string> {
  await withTimeout(
    loadInstagramStoryFonts(),
    STORY_FONT_TIMEOUT_MS,
    "Story font loading timed out",
  ).catch((error) => {
    recordDevLog(
      "share",
      "Instagram story fonts unavailable; using fallback fonts",
      { error: formatArtworkError(error) },
      "warn",
    );
  });

  const canvas = document.createElement("canvas");
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const colors = readStoryColors();

  const [artwork, logo] = await Promise.all([
    payload.imageUrl
      ? loadOptionalCanvasImage(payload.imageUrl, "artwork")
      : Promise.resolve(null),
    loadOptionalCanvasImage(CRATE_LOGO_URL, "logo"),
  ]);
  try {
    if (artwork) {
      drawStoryArtworkBackground(
        ctx,
        artwork.image,
        canvas.width,
        canvas.height,
        colors,
      );
    } else {
      drawStoryBackground(ctx, canvas.width, canvas.height, colors);
    }

    drawStoryBrand(ctx, logo?.image ?? null, colors);
    drawEditorialStoryCard(
      ctx,
      payload,
      artwork?.image ?? null,
      logo?.image ?? null,
      colors,
    );

    const encodeStartedAt = performance.now();
    const blob = await canvasToJpegBlob(canvas);
    const dataUrl = await blobToDataUrl(blob);
    recordDevLog("share", "Instagram story card encoded", {
      durationMs: Math.round(performance.now() - encodeStartedAt),
      byteLength: blob.size,
    });
    return dataUrl;
  } finally {
    artwork?.release();
    logo?.release();
  }
}

function readStoryColors(): SocialShareColors {
  const probe = document.createElement("span");
  document.documentElement.appendChild(probe);
  try {
    return readSocialShareColors(probe);
  } finally {
    probe.remove();
  }
}

export function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.94,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Story card encoding failed"));
      },
      "image/jpeg",
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Story card encoding failed"));
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Story card encoding failed"));
    reader.readAsDataURL(blob);
  });
}

let storyFontsPromise: Promise<void> | null = null;

async function loadInstagramStoryFonts(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  storyFontsPromise ??= Promise.all([
    loadFontFace("Poppins", POPPINS_600_URL, "600"),
    loadFontFace("Poppins", POPPINS_800_URL, "800"),
  ]).then(() => undefined);
  await storyFontsPromise;
}

async function loadFontFace(
  family: string,
  url: string,
  weight: string,
): Promise<void> {
  const face = new FontFace(family, `url(${url})`, {
    style: "normal",
    weight,
  });
  const loaded = await face.load();
  document.fonts.add(loaded);
}

interface CanvasArtwork {
  image: HTMLImageElement;
  release: () => void;
}

async function loadOptionalCanvasImage(
  src: string,
  label: string,
): Promise<CanvasArtwork | null> {
  try {
    return await withTimeout(
      loadCanvasImage(src),
      STORY_ASSET_TIMEOUT_MS,
      `${label} loading timed out`,
    );
  } catch (error) {
    recordDevLog(
      "share",
      `Instagram story ${label} unavailable; using fallback`,
      { error: formatArtworkError(error), src },
      "warn",
    );
    return null;
  }
}

async function loadCanvasImage(src: string): Promise<CanvasArtwork> {
  const resolvedSrc = resolveMaybeApiAssetUrl(src) || src;
  if (isNative && isHttpUrl(resolvedSrc)) {
    const dataUrl = await loadNativeHttpImageDataUrl(resolvedSrc);
    const image = await loadImageElement(dataUrl);
    return { image, release: () => undefined };
  }

  let response: Response;
  try {
    response = await fetch(resolvedSrc, { credentials: "same-origin" });
  } catch (error) {
    throw new Error(
      `Failed to load share artwork: ${formatArtworkError(error)}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to load share artwork: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error(`Failed to load share artwork: unexpected ${blob.type}`);
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImageElement(objectUrl);
    return {
      image,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadNativeHttpImageDataUrl(src: string): Promise<string> {
  const pluginDataUrl = await loadNativeSharePluginImageDataUrl(src).catch(
    (error) => {
      recordDevLog(
        "share",
        "Native story artwork loader failed; falling back to CapacitorHttp",
        { error: formatArtworkError(error), src },
        "warn",
      );
      return null;
    },
  );
  if (pluginDataUrl) return pluginDataUrl;

  let response;
  try {
    const nativeHttp = await getNativeHttpPlugin();
    if (!nativeHttp) throw new Error("native HTTP plugin is not available");
    response = await nativeHttp.get({
      url: src,
      responseType: "blob",
      connectTimeout: 15_000,
      readTimeout: 30_000,
    });
  } catch (error) {
    throw new Error(
      `Failed to load share artwork: ${formatArtworkError(error)}`,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to load share artwork: HTTP ${response.status}`);
  }
  const base64 = typeof response.data === "string" ? response.data.trim() : "";
  if (!base64) throw new Error("Failed to load share artwork: empty response");
  if (base64.startsWith("data:image/")) return base64;

  const contentType =
    getResponseHeader(response.headers, "content-type")
      ?.split(";")[0]
      ?.trim() ||
    inferImageMimeFromBase64(base64) ||
    inferImageMimeFromUrl(src);
  return `data:${contentType};base64,${base64}`;
}

async function loadNativeSharePluginImageDataUrl(
  src: string,
): Promise<string | null> {
  if (!nativeSocialShare.loadImageDataUrl) return null;
  const result = await nativeSocialShare.loadImageDataUrl({ url: src });
  const dataUrl = result.dataUrl?.trim();
  if (!dataUrl) {
    throw new Error("native social image loader returned empty data");
  }
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("native social image loader returned non-image data");
  }
  return dataUrl;
}

function getResponseHeader(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return null;
}

function inferImageMimeFromUrl(src: string): string {
  const pathname = safeUrlPathname(src).toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg"))
    return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function inferImageMimeFromBase64(base64: string): string | null {
  if (base64.startsWith("/9j/")) return "image/jpeg";
  if (base64.startsWith("iVBORw0KGgo")) return "image/png";
  if (base64.startsWith("UklGR")) return "image/webp";
  if (base64.startsWith("R0lGOD")) return "image/gif";
  if (base64.startsWith("PHN2Zy") || base64.startsWith("PD94bW")) {
    return "image/svg+xml";
  }
  return null;
}

function safeUrlPathname(src: string): string {
  try {
    return new URL(src).pathname;
  } catch {
    return src.split("?")[0] || "";
  }
}

function isHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load share artwork"));
    image.src = src;
  });
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId != null) window.clearTimeout(timeoutId);
  });
}

function formatArtworkError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "network error";
}
