import { DeferredRoute } from "@/app-shell/AppFallbacks";
import { createPreloadableLazy } from "@/lib/create-preloadable-lazy";
import { Navigate, useParams } from "react-router";

import { artistPagePath, artistTopTracksPath } from "@/lib/library-routes";

const albumRoute = createPreloadableLazy(
  () => import("@/pages/Album"),
  (module) => module.Album,
);
const LazyAlbumRoute = albumRoute.Component;

function isNumericIdSegment(value: string | undefined) {
  return Boolean(value && /^\d+$/.test(value));
}

export function ArtistChildRoute() {
  const { artistSlug, albumSlug } = useParams<{ artistSlug?: string; albumSlug?: string }>();

  if (!artistSlug || !albumSlug) {
    return <Navigate to="/artists" replace />;
  }

  if (isNumericIdSegment(artistSlug)) {
    return <Navigate to={artistPagePath({ artistSlug: albumSlug })} replace />;
  }

  return (
    <DeferredRoute>
      <LazyAlbumRoute />
    </DeferredRoute>
  );
}

export function LegacyArtistTopTracksRedirect() {
  const { legacySlug } = useParams<{ legacySlug?: string }>();
  return <Navigate to={artistTopTracksPath({ artistSlug: legacySlug || undefined })} replace />;
}
