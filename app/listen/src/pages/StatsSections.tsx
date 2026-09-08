import type { StatsPageController } from "@/pages/use-stats-page-controller";
import {
  TopAlbumsPanel,
  TopArtistsPanel,
  TopTracksPanel,
} from "./StatsCollectionPanels";
import { ListeningPulseCard, SoundProfileCard } from "./StatsAnalyticsSections";

export function StatsAnalyticsSection({ page }: { page: StatsPageController }) {
  return (
    <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <SoundProfileCard
        profile={page.soundProfile}
        genres={page.topGenreItems}
        skipRate={page.overview?.skip_rate ?? 0}
      />
      <ListeningPulseCard
        story={page.story}
        points={page.trends?.points ?? []}
        loading={page.dashboardLoading}
      />
    </section>
  );
}

export function StatsCollectionsSection({
  page,
}: {
  page: StatsPageController;
}) {
  return (
    <>
      <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <TopTracksPanel
          items={page.topTrackItems}
          loading={page.dashboardLoading}
          onPlayTrack={page.playTopTrack}
        />
        <TopArtistsPanel
          items={page.topArtistItems}
          loading={page.dashboardLoading}
        />
      </section>
      <TopAlbumsPanel
        items={page.topAlbumItems}
        loading={page.dashboardLoading}
      />
    </>
  );
}
