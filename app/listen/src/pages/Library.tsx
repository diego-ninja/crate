import { type ComponentType, useCallback, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Plus, Heart, Users, Disc, ListMusic } from "@crate/ui/icons";
import { useApi } from "@/hooks/use-api";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { LibraryBandcampTab } from "./LibraryBandcampTab";
import {
  LibraryAlbumsTab,
  LibraryArtistsTab,
  LibraryLikedTab,
} from "./LibraryCollectionTabs";
import { LibraryContributionsTab } from "./LibraryContributionsTab";
import { LibraryPlaylistsTab } from "./LibraryPlaylistsTab";
import { StatBox } from "./LibraryPrimitives";

type Tab =
  | "playlists"
  | "artists"
  | "albums"
  | "liked"
  | "bandcamp"
  | "contributions";

type TabIcon = ComponentType<{ size?: number; className?: string }>;

interface MeStats {
  followed_artists: number;
  saved_albums: number;
  liked_tracks: number;
  playlists: number;
}

const tabs: { key: Tab; labelKey: string; icon: TabIcon }[] = [
  { key: "playlists", labelKey: "nav.collection.playlists", icon: ListMusic },
  { key: "artists", labelKey: "nav.collection.artists", icon: Users },
  { key: "albums", labelKey: "nav.collection.albums", icon: Disc },
  { key: "liked", labelKey: "library.tabs.liked", icon: Heart },
  { key: "bandcamp", labelKey: "nav.collection.bandcamp", icon: BandcampLogo },
  {
    key: "contributions",
    labelKey: "nav.collection.contributions",
    icon: Plus,
  },
];

const tabTitleKeys: Record<Tab, string> = {
  playlists: "nav.collection",
  artists: "nav.collection.artists",
  albums: "nav.collection.albums",
  liked: "nav.collection.likedTracks",
  bandcamp: "nav.collection.bandcamp",
  contributions: "nav.collection.contributions",
};

function parseTab(value: string | null): Tab {
  if (
    value === "artists" ||
    value === "albums" ||
    value === "liked" ||
    value === "bandcamp" ||
    value === "contributions"
  )
    return value;
  return "playlists";
}

export function Library() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { section } = useParams<{ section?: string }>();
  const isDesktop = useIsDesktop();
  const { data: stats, refetch: refetchStats } = useApi<MeStats>(
    isDesktop ? "/api/me" : null,
  );
  const tab = section ? parseTab(section) : parseTab(searchParams.get("tab"));
  const [refreshKey, setRefreshKey] = useState(0);

  const onRefresh = useCallback(async () => {
    refetchStats();
    setRefreshKey((k) => k + 1);
  }, [refetchStats]);

  const {
    handlers: pullHandlers,
    pullDistance,
    refreshing,
  } = usePullToRefresh(onRefresh);

  function setTab(tab: Tab) {
    setSearchParams({ tab });
  }

  return (
    <div className="space-y-6" {...pullHandlers}>
      <PullIndicator distance={pullDistance} refreshing={refreshing} />
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">
          {isDesktop ? t("library.title.desktop") : t(tabTitleKeys[tab])}
        </h1>
      </div>

      {/* Stats */}
      {stats && (
        <div className="hidden gap-2 md:flex">
          <StatBox
            value={stats.followed_artists}
            label={t("nav.collection.artists")}
          />
          <StatBox
            value={stats.saved_albums}
            label={t("nav.collection.albums")}
          />
          <StatBox value={stats.liked_tracks} label={t("common.tracks")} />
          <StatBox
            value={stats.playlists}
            label={t("nav.collection.playlists")}
          />
        </div>
      )}

      {/* Tab bar */}
      {isDesktop ? (
        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex scroll-px-4 gap-2 overflow-x-auto pr-8 transform-gpu will-change-scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] sm:pr-0">
            {tabs.map(({ key, labelKey, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-accent-action text-accent-action-foreground"
                    : "bg-text-primary/5 text-text-muted hover:bg-text-primary/10 hover:text-text-primary"
                }`}
              >
                <Icon size={14} />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Tab content */}
      {tab === "playlists" && <LibraryPlaylistsTab key={refreshKey} />}
      {tab === "artists" && <LibraryArtistsTab key={refreshKey} />}
      {tab === "albums" && <LibraryAlbumsTab key={refreshKey} />}
      {tab === "liked" && <LibraryLikedTab key={refreshKey} />}
      {tab === "bandcamp" && <LibraryBandcampTab key={refreshKey} />}
      {tab === "contributions" && <LibraryContributionsTab key={refreshKey} />}
    </div>
  );
}
