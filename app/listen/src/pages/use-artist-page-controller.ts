import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "react-router";
import { toast } from "sonner";

import type { Track } from "@/contexts/PlayerContext";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { publicShareUrl } from "@/lib/share-url";
import { openShareSheet } from "@/lib/social-share";
import { fetchArtistRadio } from "@/lib/radio";
import { fetchPlayableSetlist } from "@/lib/upcoming";
import { shuffleArray } from "@/lib/utils";
import {
  artistPhotoApiUrl,
  artistSharePath,
  globalArtistUidFromRouteRef,
} from "@/lib/library-routes";
import type { ArtistPageData } from "@/components/artist/artist-model";
import {
  buildArtistCanonicalPath,
  buildArtistPageViewModel,
  buildArtistRequestPath,
  type ArtistPageViewModel,
} from "@/pages/artist-page-model";

export interface ArtistPageController {
  canonicalPath: string | null;
  error: unknown;
  handleArtistRadio: () => Promise<void>;
  handlePlayArtistSetlist: () => Promise<void>;
  handlePlayTopTracks: (startIndex?: number, shuffle?: boolean) => void;
  handleShare: () => void;
  locationPath: string;
  loading: boolean;
  page: ArtistPageViewModel | undefined;
  refetch: () => void;
  status: number | null | undefined;
  t: ReturnType<typeof useTranslation>["t"];
  toggleFollow: () => Promise<void>;
  following: boolean;
}

export type LoadedArtistPageController = Omit<ArtistPageController, "page"> & {
  page: ArtistPageViewModel;
};

export function useArtistPageController(): ArtistPageController {
  const { t } = useTranslation();
  const { artistSlug: routeArtistSlug, globalArtistUid: routeGlobalArtistRef } =
    useParams<{ artistSlug?: string; globalArtistUid?: string }>();
  const routeGlobalArtistUid =
    globalArtistUidFromRouteRef(routeGlobalArtistRef);
  const location = useLocation();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const { playAll } = usePlayerActions();
  const {
    data: pageData,
    loading,
    error,
    status,
    refetch,
  } = useApi<ArtistPageData>(
    buildArtistRequestPath(routeGlobalArtistUid, routeArtistSlug),
    "GET",
    undefined,
    { safetyNetMs: 120_000 },
  );
  const page = pageData
    ? buildArtistPageViewModel(pageData, routeGlobalArtistUid)
    : undefined;
  const data = page?.data;
  const currentGlobalArtistUid = page?.currentGlobalArtistUid ?? null;

  async function toggleFollow() {
    if (!data?.id && !currentGlobalArtistUid) return;
    try {
      await toggleArtistFollow(data?.id, currentGlobalArtistUid, data?.name);
    } catch {
      // Follow state rolls back in ArtistFollowsContext.
    }
  }

  function handleShare() {
    if (!data?.id && !currentGlobalArtistUid) return;
    const shareUrl = publicShareUrl(
      artistSharePath({
        artistId: data?.id,
        artistEntityUid: data?.entity_uid,
        globalArtistUid: currentGlobalArtistUid,
        artistSlug: data?.slug,
        artistName: data?.name,
      }),
    );
    openShareSheet({
      kind: "artist",
      title: data?.name || t("artist.fallbackName"),
      imageUrl:
        data?.has_photo === false
          ? null
          : artistPhotoApiUrl(
              {
                artistId: data?.id,
                globalArtistUid: currentGlobalArtistUid,
                artistSlug: data?.slug,
                artistName: data?.name,
              },
              { size: 512, version: data?.updated_at ?? undefined },
            ),
      url: shareUrl,
    });
  }

  async function handleArtistRadio() {
    const currentArtistSeed =
      data?.id ??
      routeGlobalArtistUid ??
      data?.global_artist_uid ??
      data?.global_uid;
    if (currentArtistSeed == null || !data?.name) return;
    try {
      const radio = await fetchArtistRadio(currentArtistSeed, data.name);
      if (!radio.tracks.length) {
        toast.info(t("artist.toasts.radioUnavailable"));
        return;
      }
      const queue: Track[] = radio.tracks.map((track) => ({
        ...track,
        albumCover: track.albumCover || page?.coverFallback,
      }));
      playAll(queue, 0, radio.source);
    } catch {
      toast.error(t("artist.toasts.radioFailed"));
    }
  }

  function handlePlayTopTracks(startIndex = 0, shuffle = false) {
    if (!page?.playerTracks.length) {
      toast.info(t("artist.toasts.noTopTracks"));
      return;
    }
    const queue = shuffle ? shuffleArray(page.playerTracks) : page.playerTracks;
    playAll(queue, shuffle ? 0 : startIndex, {
      type: "queue",
      name: t("artist.playSource.topTracks", {
        name: data?.name || t("artist.fallbackName"),
      }),
    });
  }

  async function handlePlayArtistSetlist() {
    try {
      if (!data?.id) return;
      const queue = await fetchPlayableSetlist({
        artistId: data.id,
        artistName: data.name,
      });
      if (!queue.length) {
        toast.info(t("artist.toasts.noSetlistMatches"));
        return;
      }
      playAll(queue, 0, {
        type: "playlist",
        name: t("artist.playSource.probableSetlist", { name: data.name }),
      });
      toast.success(t("artist.toasts.playingSetlist", { count: queue.length }));
    } catch {
      toast.error(t("artist.toasts.setlistFailed"));
    }
  }

  return {
    canonicalPath:
      page && data
        ? buildArtistCanonicalPath(data, routeGlobalArtistUid)
        : null,
    error,
    handleArtistRadio,
    handlePlayArtistSetlist,
    handlePlayTopTracks,
    handleShare,
    locationPath: location.pathname,
    loading,
    page,
    refetch,
    status,
    t,
    toggleFollow,
    following: isFollowing(data?.id, currentGlobalArtistUid),
  };
}
