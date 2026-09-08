import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useArtistFollows } from "@/contexts/ArtistFollowsContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import {
  buildHomePageActions,
  type HomePageActions,
} from "@/pages/home-page-actions";
import {
  buildHomePageViewModel,
  type HomePageViewModel,
} from "@/pages/home-page-model";
import { useHomeDiscoveryStream } from "@/pages/use-home-discovery-stream";

export interface HomePageController extends HomePageActions {
  discoveryError: unknown;
  discoveryLoading: boolean;
  i18nLanguage: string;
  isDesktop: boolean;
  navigate: (to: string) => void;
  pullDistance: number;
  pullHandlers: ReturnType<typeof usePullToRefresh>["handlers"];
  refreshing: boolean;
  t: ReturnType<typeof useTranslation>["t"];
  view: HomePageViewModel | undefined;
  isFollowing: (artistId?: number | null) => boolean;
  refreshLiveDiscovery: (fresh?: boolean) => Promise<void>;
  refetchDiscovery: () => void;
}

export function useHomePageController(): HomePageController {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { play, playAll } = usePlayerActions();
  const { isFollowing, toggleArtistFollow } = useArtistFollows();
  const isDesktop = useIsDesktop();
  const {
    currentDiscovery,
    discoveryError,
    discoveryLoading,
    refreshLiveDiscovery,
    refetchDiscovery,
  } = useHomeDiscoveryStream();
  const view = useMemo(
    () =>
      currentDiscovery ? buildHomePageViewModel(currentDiscovery) : undefined,
    [currentDiscovery],
  );
  const onRefresh = useCallback(async () => {
    await refreshLiveDiscovery(true);
    refetchDiscovery();
  }, [refetchDiscovery, refreshLiveDiscovery]);
  const {
    handlers: pullHandlers,
    pullDistance,
    refreshing,
  } = usePullToRefresh(onRefresh);
  const actions = buildHomePageActions({
    navigate,
    play,
    playAll,
    refetchDiscovery,
    replay: view?.replay,
    replayMonth: view?.replayMonth,
    t,
    toggleArtistFollow,
  });

  return {
    ...actions,
    discoveryError,
    discoveryLoading,
    i18nLanguage: i18n.language,
    isDesktop,
    navigate,
    pullDistance,
    pullHandlers,
    refreshing,
    t,
    view,
    isFollowing,
    refreshLiveDiscovery,
    refetchDiscovery,
  };
}
