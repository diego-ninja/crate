import type { Track } from "@/contexts/player-types";
import { apiUrl } from "@/lib/api";
import type {
  CastMediaResponse,
  CastStartPayload,
  CastTicketRequest,
  CastTicketResponse,
  ChromeCastImage,
  ChromeCastLoadRequest,
  ChromeCastMediaInfo,
  ChromeCastMusicMetadata,
  ChromeCastNamespace,
  NativeCastMediaPayload,
} from "./cast-sender-types";

export const DEFAULT_CAST_TARGET_ID = "google-cast:default";
export const DEFAULT_RECEIVER_CAPABILITIES = {
  formats: ["mp3", "aac", "m4a"],
  content_types: ["audio/mpeg", "audio/aac", "audio/mp4"],
};

function receiverArtworkUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:")
  ) {
    return undefined;
  }
  if (url.startsWith("/api/")) return apiUrl(url);
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return undefined;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return undefined;
  }
}

function mediaDurationSeconds(
  media: CastMediaResponse,
  track: Track,
): number | undefined {
  if (typeof media.duration_ms === "number" && media.duration_ms > 0) {
    return media.duration_ms / 1000;
  }
  if (typeof track.duration === "number" && track.duration > 0) {
    return track.duration;
  }
  return undefined;
}

export async function resolveCastMedia(
  ticket: CastTicketResponse,
): Promise<CastMediaResponse> {
  const response = await fetch(ticket.metadata_url, {
    credentials: "omit",
  });
  if (response.status === 425) {
    throw new Error(
      "Receiver-safe audio is still preparing. Try again shortly.",
    );
  }
  if (!response.ok) {
    throw new Error("Could not prepare this track for Cast.");
  }
  return (await response.json()) as CastMediaResponse;
}

export function buildNativePayload(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
): NativeCastMediaPayload {
  const track = payload.track;
  return {
    streamUrl: media.stream_url || ticket.stream_url,
    metadataUrl: ticket.metadata_url,
    contentType: media.content_type || "audio/mpeg",
    title: media.title || track.title,
    artist: media.artist || track.artist,
    album: media.album || track.album || "",
    artworkUrl: receiverArtworkUrl(track.albumCover),
    duration: mediaDurationSeconds(media, track),
    currentTime: payload.currentTime,
  };
}

export function buildWebLoadRequest(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
  chromeCast: ChromeCastNamespace,
): ChromeCastLoadRequest {
  const nativePayload = buildNativePayload(ticket, media, payload);
  const mediaInfo = new chromeCast.media.MediaInfo(
    nativePayload.streamUrl,
    nativePayload.contentType,
  ) as ChromeCastMediaInfo;
  const metadata = new chromeCast.media.MusicTrackMediaMetadata();
  metadata.title = nativePayload.title;
  metadata.artist = nativePayload.artist;
  metadata.albumName = nativePayload.album;

  if (nativePayload.artworkUrl) {
    metadata.images = [
      new chromeCast.Image(nativePayload.artworkUrl) as ChromeCastImage,
    ];
  }

  mediaInfo.metadata = metadata as ChromeCastMusicMetadata;
  mediaInfo.duration = nativePayload.duration;
  mediaInfo.customData = {
    metadataUrl: nativePayload.metadataUrl,
    delivery: media.delivery,
  };

  const request = new chromeCast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  request.currentTime = Math.max(0, Math.floor(payload.currentTime || 0));
  return request;
}

export function buildCastTicketRequest(
  track: Track,
  targetDeviceId: string = DEFAULT_CAST_TARGET_ID,
): CastTicketRequest | null {
  const request: CastTicketRequest = {
    purpose: "google_cast",
    target_device_id: targetDeviceId,
    delivery: "auto",
    receiver_capabilities: DEFAULT_RECEIVER_CAPABILITIES,
  };

  if (typeof track.libraryTrackId === "number" && track.libraryTrackId > 0) {
    request.track_id = track.libraryTrackId;
    return request;
  }
  if (track.entityUid) {
    request.track_entity_uid = track.entityUid;
    return request;
  }
  if (track.path) {
    request.track_path = track.path;
    return request;
  }
  return null;
}
