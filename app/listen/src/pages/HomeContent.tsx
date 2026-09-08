import {
  EssentialsSection,
  FavoriteArtistsSection,
  HomeTasteHero,
  openRecentItemPath,
  RecentlyPlayedSection,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
  UpcomingAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import { HomeReplaySection } from "@/components/home/HomePlaybackSections";
import {
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import {
  HomeShowPrepSection,
  HomeUpcomingSection,
} from "@/components/home/HomeUpcomingSections";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";

import type { HomePageController } from "@/pages/use-home-page-controller";
import type { HomePageViewModel } from "@/pages/home-page-model";
import { homePlaylistPath } from "@/pages/home-page-model";

type LoadedHomePageController = Omit<HomePageController, "view"> & {
  view: HomePageViewModel;
};

interface HomeSectionProps {
  page: LoadedHomePageController;
}

function HomeHero({ page }: HomeSectionProps) {
  const { heroes, currentDiscovery } = page.view;
  const homeIntro = (
    <div>
      <h1 className="text-3xl font-bold text-text-primary">
        {getHomeGreeting(page.t)}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {getHomeDateString(page.i18nLanguage)}
      </p>
    </div>
  );

  return (
    <HomeTasteHero
      heroes={heroes}
      heroSurfaces={currentDiscovery.hero_surfaces}
      isFollowing={page.isFollowing}
      onOpenArtist={page.openArtist}
      onPlay={(artist) => void page.playHeroArtist(artist)}
      onToggleFollow={(artist) => void page.toggleHeroFollow(artist)}
      desktopIntro={page.isDesktop ? homeIntro : undefined}
    />
  );
}

function HomeCommonRails({ page }: HomeSectionProps) {
  const { currentDiscovery, upcomingPreview, upcoming, homeInsights } =
    page.view;

  return (
    <>
      <SuggestedAlbumsSection
        albums={currentDiscovery.suggested_albums || []}
        onViewAll={page.openHomeSection}
      />
      <UpcomingAlbumsSection
        albums={currentDiscovery.upcoming_albums || []}
        onViewAll={page.openHomeSection}
      />
      <HomeUpcomingSection
        previewItems={upcomingPreview}
        summary={upcoming?.summary}
        onOpenUpcoming={() => page.navigate("/upcoming")}
        onPlaySetlist={(item) => void page.playUpcomingSetlist(item)}
      />
      <HomeShowPrepSection
        insights={homeInsights}
        onOpenUpcoming={() => page.navigate("/upcoming")}
        onPlaySetlist={(insight) => void page.playInsightSetlist(insight)}
        onSaveReminder={(insight) => void page.acknowledgeInsight(insight)}
      />
    </>
  );
}

function HomeMobileRails({ page }: HomeSectionProps) {
  const { recentGlobalArtists, globalArtistsLoading } = page.view;

  return (
    <>
      <JustLandedSection
        artists={recentGlobalArtists}
        loading={globalArtistsLoading}
        onOpenExplore={() => page.navigate("/explore")}
      />
      <HomeCommonRails page={page} />
    </>
  );
}

function HomeDesktopRails({ page }: HomeSectionProps) {
  const { currentDiscovery, replay, replayPreview, recommendedTracks } =
    page.view;

  return (
    <>
      <RecommendedTracksSection
        tracks={recommendedTracks}
        onViewAll={page.openHomeSection}
      />
      <FavoriteArtistsSection
        artists={currentDiscovery.favorite_artists || []}
        onViewAll={page.openHomeSection}
      />
      <EssentialsSection
        items={currentDiscovery.essentials || []}
        onOpenPlaylist={(item) => page.navigate(homePlaylistPath(item.id))}
        onPlayPlaylist={(item) => void page.playHomePlaylist(item)}
        onShufflePlaylist={(item) => void page.shuffleHomePlaylist(item)}
        onStartRadio={(item) => void page.startHomePlaylistRadio(item)}
        onViewAll={page.openHomeSection}
      />
      <HomeCommonRails page={page} />
      <HomeReplaySection
        replay={replay || undefined}
        replayPreview={replayPreview}
        onOpenStats={page.openReplayStats}
        onPlayReplay={page.playReplayMix}
        onPlayTrack={page.playReplayTrack}
      />
    </>
  );
}

function HomeDiscoveryRails({ page }: HomeSectionProps) {
  const { currentDiscovery } = page.view;

  return (
    <div
      data-testid="home-discovery-content"
      className={`mx-auto w-full max-w-[1480px] space-y-10 px-6 pb-10 ${
        page.isDesktop ? "relative z-30 mt-0 pt-8 2xl:-mt-16 2xl:pt-0" : "pt-8"
      }`}
      style={{
        paddingLeft: page.isDesktop
          ? undefined
          : "max(1rem, var(--listen-safe-left))",
        paddingRight: page.isDesktop
          ? undefined
          : "max(1rem, var(--listen-safe-right))",
      }}
    >
      <RecentlyPlayedSection
        items={currentDiscovery.recently_played || []}
        onOpenItem={(item) => page.navigate(openRecentItemPath(item))}
        onViewAll={page.openHomeSection}
      />
      {page.isDesktop ? (
        <HomeDesktopRails page={page} />
      ) : (
        <HomeMobileRails page={page} />
      )}
    </div>
  );
}

export function HomeContent({ page }: HomeSectionProps) {
  return (
    <div className="w-full" {...page.pullHandlers}>
      <PullIndicator
        distance={page.pullDistance}
        refreshing={page.refreshing}
      />
      <HomeHero page={page} />
      <HomeDiscoveryRails page={page} />
    </div>
  );
}
