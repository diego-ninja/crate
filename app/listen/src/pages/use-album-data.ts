import { useLocation, useNavigate, useParams } from "react-router";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useApi } from "@/hooks/use-api";
import type { AlbumData } from "@/pages/album-types";
import { globalAlbumUidFromRouteRef } from "@/lib/library-routes";
import {
  buildAlbumDataState,
  buildAlbumRequestPath,
} from "@/pages/album-data-model";

export function useAlbumData() {
  const {
    albumId: albumIdParam,
    artistSlug: routeArtistSlug,
    albumSlug: routeAlbumSlug,
    globalAlbumUid: routeGlobalAlbumRef,
  } = useParams<{
    albumId?: string;
    artistSlug?: string;
    albumSlug?: string;
    globalAlbumUid?: string;
  }>();
  const routeGlobalAlbumUid = globalAlbumUidFromRouteRef(routeGlobalAlbumRef);
  const routeAlbumId = albumIdParam ? Number(albumIdParam) : undefined;
  const { data, loading, error } = useApi<AlbumData>(
    buildAlbumRequestPath({
      routeAlbumId,
      routeAlbumSlug,
      routeArtistSlug,
      routeGlobalAlbumUid,
    }),
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const derived = buildAlbumDataState({
    data,
    routeGlobalAlbumUid,
  });

  return {
    ...derived,
    data,
    error,
    isDesktop,
    loading,
    locationPath: location.pathname,
    navigate,
    routeGlobalAlbumUid,
    sharedTrackUid: new URLSearchParams(location.search).get("track"),
  };
}

export type AlbumDataState = ReturnType<typeof useAlbumData>;
