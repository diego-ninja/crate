import { BarChart3 } from "@crate/ui/icons";

import {
  useStatsPageController,
  type StatsPageController,
} from "@/pages/use-stats-page-controller";
import {
  AffinityCard,
  ScopeLink,
  StatsEmptyState,
  StatsRecapSection,
} from "./StatsNarrativeSections";
import {
  StatsAnalyticsSection,
  StatsCollectionsSection,
} from "./StatsSections";
import { StatsStorySection } from "./StatsStorySections";
import { StatsHeroSection } from "./StatsHeroSections";
import { WindowPicker } from "@/components/stats/StatsPanels";

export function Stats() {
  const page = useStatsPageController();
  return <StatsPageContent page={page} />;
}

function StatsPageContent({ page }: { page: StatsPageController }) {
  const {
    dashboard,
    dashboardLoading,
    hasStats,
    recapHighlights,
    story,
    subjectName,
    topComeback,
    topDiscovery,
    topMover,
  } = page;

  return (
    <div className="relative -mx-4 -mt-2 overflow-hidden px-4 pb-12 pt-3 sm:-mx-6 sm:px-6">
      <div className="stats-page-atmosphere pointer-events-none absolute inset-0 -z-10" />
      <div className="stats-page-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-30" />
      <StatsHeader page={page} />
      <StatsHeroSection page={page} />
      <StatsRecapSection highlights={recapHighlights} t={page.t} />
      <StatsStorySection
        story={story}
        fallbackMover={topMover}
        fallbackDiscovery={topDiscovery}
        fallbackComeback={topComeback}
      />
      <AffinityCard
        affinity={dashboard?.viewer_affinity}
        subject={subjectName}
      />
      <StatsAnalyticsSection page={page} />
      <StatsCollectionsSection page={page} />
      {!dashboardLoading && !hasStats ? <StatsEmptyState t={page.t} /> : null}
    </div>
  );
}

function StatsHeader({ page }: { page: StatsPageController }) {
  const { t, heroBody, heroTitle, isGlobalStats, isUserStats, username } = page;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="stats-hero-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.24em]">
          <BarChart3 size={12} />
          {t("stats.hero.badge")}
        </div>
        <h1 className="stats-hero-title mt-4 max-w-4xl text-[clamp(2.65rem,8vw,7.5rem)] font-black uppercase leading-[0.82] tracking-[-0.085em]">
          {heroTitle}
          <span className="stats-hero-title-accent block">
            {t("stats.hero.decoded")}
          </span>
        </h1>
        <p className="stats-hero-body mt-4 max-w-2xl text-sm leading-6 sm:text-base">
          {heroBody}
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 lg:items-end">
        <div className="flex flex-wrap gap-2">
          {!isUserStats ? (
            <>
              <ScopeLink active={!isGlobalStats} to="/stats">
                {t("stats.scope.yourDna")}
              </ScopeLink>
              <ScopeLink active={isGlobalStats} to="/stats/global">
                {t("stats.scope.cratePulse")}
              </ScopeLink>
            </>
          ) : username ? (
            <ScopeLink active={false} to={"/users/" + username}>
              {t("stats.scope.backToProfile")}
            </ScopeLink>
          ) : null}
        </div>
        <WindowPicker
          value={page.selectedMonth ? null : page.selectedWindow}
          onChange={page.changeWindow}
        />
      </div>
    </div>
  );
}
