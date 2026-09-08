import { useEffect, useMemo } from "react";
import type { ImgHTMLAttributes } from "react";

import {
  useMediaAccessResumeVersion,
  useMediaAccessVersion,
} from "@/hooks/use-media-access-version";
import {
  canonicalArtworkTransportIdentity,
  resolveArtworkCandidate,
} from "@/lib/artwork-manager";
import { requiresMediaAccessTicket } from "@/lib/api";
import {
  artworkFromUrl,
  type ArtworkRetryPolicy,
  type ArtworkSource,
} from "@/lib/artwork-source";

import { useCrateImageLifecycle } from "./use-crate-image-lifecycle";

export interface CrateImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source?: ArtworkSource | string | null;
  src?: string | null;
  retryPolicy?: ArtworkRetryPolicy;
  onArtworkStateChange?: (state: "empty" | "loading" | "ready") => void;
}

export function CrateImage({
  source,
  src,
  srcSet,
  sizes,
  retryPolicy,
  onArtworkStateChange,
  onError,
  onLoad,
  loading,
  ...props
}: CrateImageProps) {
  const ticketVersion = useMediaAccessVersion();
  const resumeVersion = useMediaAccessResumeVersion();
  const rawSource = source ?? src ?? null;
  const artwork = useMemo<ArtworkSource>(() => {
    if (typeof rawSource !== "string") {
      if (rawSource) return rawSource;
      return artworkFromUrl(null, {
        logicalKey: "unknown:missing",
        retryPolicy: retryPolicy ?? "none",
      });
    }
    return artworkFromUrl(rawSource, {
      logicalKey: "unknown:url:" + canonicalArtworkTransportIdentity(rawSource),
      retryPolicy:
        retryPolicy ??
        (requiresMediaAccessTicket(rawSource) ? "credentials" : "none"),
      srcSet,
      sizes,
    });
  }, [rawSource, retryPolicy, sizes, srcSet]);
  const isTicketedArtwork = requiresMediaAccessTicket(artwork.src);
  const preservesReadyArtwork =
    artwork.retryPolicy === "credentials" || isTicketedArtwork;
  const resolved = useMemo(
    () => resolveArtworkCandidate(artwork),
    // ticketVersion intentionally re-registers protected paths. Content
    // identity prevents credential-only churn from reaching the DOM.
    [artwork, resumeVersion, ticketVersion],
  );
  const {
    displayed,
    imageRef,
    onError: handleError,
    onLoad: handleLoad,
  } = useCrateImageLifecycle({
    artwork,
    resolved,
    preservesReadyArtwork,
    resumeVersion,
    loading,
    onError,
    onLoad,
  });

  useEffect(() => {
    onArtworkStateChange?.(
      !displayed ? "empty" : displayed.ready ? "ready" : "loading",
    );
  }, [displayed, onArtworkStateChange]);

  if (!displayed) return null;
  const displayedSizes =
    resolved &&
    resolved.logicalKey === displayed.candidate.logicalKey &&
    resolved.contentKey === displayed.candidate.contentKey
      ? resolved.sizes
      : displayed.candidate.sizes;

  return (
    <img
      {...props}
      ref={imageRef}
      data-artwork-managed="true"
      data-artwork-state={displayed.ready ? "ready" : "loading"}
      loading={loading}
      src={displayed.candidate.src}
      srcSet={displayed.candidate.srcSet}
      sizes={displayedSizes}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
