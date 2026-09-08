import { isNative } from "@/lib/capacitor-runtime";

import { nativeSocialShare } from "./social-share-native";
import {
  buildInstagramStoryCard,
  withTimeout,
} from "./social-share-story-builder";

export { canvasToJpegBlob } from "./social-share-story-builder";

export const SHARE_REQUEST_EVENT = "crate:share-request";

const STORY_NATIVE_SHARE_TIMEOUT_MS = 8000;

export type ShareSubjectKind =
  | "track"
  | "album"
  | "artist"
  | "playlist"
  | "genre";

export interface SharePayload {
  kind: ShareSubjectKind;
  title: string;
  url: string;
  subtitle?: string | null;
  imageUrl?: string | null;
}

export function buildShareText(payload: SharePayload): string {
  const title = payload.title.trim();
  const subtitle = payload.subtitle?.trim();
  if (!subtitle || subtitle === title) return title;
  return `${title} - ${subtitle}`;
}

export function buildWhatsAppShareUrl(payload: SharePayload): string {
  return `https://wa.me/?text=${encodeURIComponent(
    `${buildShareText(payload)}\n${payload.url}`,
  )}`;
}

export function buildTelegramShareUrl(payload: SharePayload): string {
  const params = new URLSearchParams({
    url: payload.url,
    text: buildShareText(payload),
  });
  return `https://t.me/share/url?${params.toString()}`;
}

export function openShareSheet(payload: SharePayload): boolean {
  if (typeof window === "undefined") return false;
  window.dispatchEvent(
    new CustomEvent<SharePayload>(SHARE_REQUEST_EVENT, { detail: payload }),
  );
  return true;
}

export function subscribeShareRequests(
  listener: (payload: SharePayload) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SharePayload>).detail);
  };
  window.addEventListener(SHARE_REQUEST_EVENT, handler);
  return () => window.removeEventListener(SHARE_REQUEST_EVENT, handler);
}

export async function canShareInstagramStory(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const result = await nativeSocialShare.canShareInstagramStory();
    return Boolean(result.available);
  } catch {
    return false;
  }
}

export async function shareInstagramStory(
  payload: SharePayload,
): Promise<void> {
  if (!isNative) {
    throw new Error(
      "Instagram Stories sharing is only available in mobile apps",
    );
  }
  const imageDataUrl = await buildInstagramStoryCard(payload);
  await withTimeout(
    nativeSocialShare.shareInstagramStory({
      imageDataUrl,
      contentUrl: payload.url,
    }),
    STORY_NATIVE_SHARE_TIMEOUT_MS,
    "Instagram Stories did not respond",
  );
}
