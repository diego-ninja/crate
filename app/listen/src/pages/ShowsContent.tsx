import type { ReactNode } from "react";

import { Calendar, Loader2, Sparkles } from "@crate/ui/icons";

import {
  groupByMonth,
  UpcomingMonthGroup,
  UpcomingShowCard,
} from "@/components/upcoming/UpcomingRows";
import { cn } from "@/lib/utils";
import type { ShowsFilter } from "@/pages/shows-page-model";
import type { ShowsPageController } from "@/pages/use-shows-page-controller";

interface ShowsSectionProps {
  page: ShowsPageController;
}

function ShowsHeader({ page }: ShowsSectionProps) {
  const headingCopy = page.isGenreRadar
    ? page.t("radar.genreIntro", { genre: page.genreName || page.genreSlug })
    : page.t("radar.intro");

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-3xl font-bold text-text-primary">Radar</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
          {headingCopy}
        </p>
      </div>
      <ShowsSummary page={page} />
    </div>
  );
}

function ShowsSummary({ page }: ShowsSectionProps) {
  if (!page.summary) return null;

  return (
    <ul
      aria-label={page.t("radar.summaryAria")}
      className="hidden list-none flex-wrap items-center gap-2 md:flex"
    >
      {page.isGenreRadar ? (
        <SummaryPill
          label={page.t("radar.summary.shows")}
          value={page.summary.show_count}
          accent="cyan"
        />
      ) : (
        <>
          <SummaryPill
            label={page.t("radar.summary.followedArtists")}
            value={page.summary.followed_artists}
          />
          <SummaryPill
            label={page.t("radar.summary.shows")}
            value={page.summary.show_count}
            accent="cyan"
          />
          <SummaryPill
            label={page.t("radar.summary.releases")}
            value={page.summary.release_count}
            accent="cyan"
          />
          <SummaryPill
            label={page.t("radar.summary.attending")}
            value={page.attendingShows.length}
            accent="cyan"
          />
        </>
      )}
    </ul>
  );
}

function SummaryPill({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: number;
  accent?: "neutral" | "cyan";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-accent-action/20 text-accent-action"
      : "border-border-quiet text-text-primary/60";

  return (
    <li
      className={cn(
        "rounded-lg border bg-text-primary/[0.03] px-3 py-2",
        accentClass,
      )}
    >
      <div className="text-xs uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </li>
  );
}

function ShowsFeatured({ page }: ShowsSectionProps) {
  if (!page.featuredShow) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Calendar size={15} className="text-accent-action" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-accent-action">
          {page.t("radar.sections.nextShow")}
        </h2>
      </div>
      <UpcomingShowCard
        item={page.featuredShow}
        expanded
        featured
        showClose={false}
        onToggle={() => undefined}
      />
    </section>
  );
}

const SHOW_FILTERS: ShowsFilter[] = ["all", "shows", "releases"];

function ShowsFilters({ page }: ShowsSectionProps) {
  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-text-primary/5 bg-text-primary/[0.02] p-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {SHOW_FILTERS.map((value) => (
          <button
            key={value}
            onClick={() => page.setFilter(value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-colors",
              page.filter === value
                ? "border-accent-action/40 bg-accent-action/15 text-accent-action"
                : "border-border-quiet text-text-muted hover:border-text-primary/20 hover:text-text-primary",
            )}
          >
            {filterLabel(page, value)}
          </button>
        ))}
      </div>
      <div className="relative w-full md:w-[280px]">
        <input
          type="text"
          value={page.search}
          onChange={(event) => page.setSearch(event.target.value)}
          placeholder={page.t("radar.searchPlaceholder")}
          className="h-11 w-full rounded-lg border border-border-quiet bg-surface-canvas/25 px-4 text-base text-text-primary placeholder:text-text-primary/40 focus:border-accent-action/40 focus:outline-none"
        />
      </div>
    </div>
  );
}

function filterLabel(page: ShowsPageController, filter: ShowsFilter) {
  if (filter === "all") return page.t("radar.filters.all");
  if (filter === "shows") return page.t("radar.filters.shows");
  return page.t("radar.filters.releases");
}

function ShowsEmptyStates({ page }: ShowsSectionProps) {
  if (page.loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={24} className="animate-spin text-accent-action" />
      </div>
    );
  }
  if (page.isGenreRadar && page.items.length === 0) {
    return (
      <EmptyState
        icon={<Calendar size={22} className="text-accent-action" />}
        title={page.t("radar.empty.genreTitle")}
        body={page.t("radar.empty.genreBody")}
      />
    );
  }
  if (!page.isGenreRadar && !page.hasFollowedArtists) {
    return (
      <EmptyState
        icon={<Sparkles size={22} className="text-accent-action" />}
        title={page.t("radar.empty.followTitle")}
        body={page.t("radar.empty.followBody")}
      />
    );
  }
  if (
    !page.isGenreRadar &&
    page.hasFollowedArtists &&
    page.items.length === 0
  ) {
    return (
      <EmptyState
        icon={<Sparkles size={22} className="text-accent-action" />}
        title={page.t("radar.empty.noSignalsTitle")}
        body={page.t("radar.empty.noSignalsBody")}
      />
    );
  }
  if (
    page.hasFollowedArtists &&
    page.items.length > 0 &&
    page.filtered.length === 0
  ) {
    return (
      <EmptyState
        icon={<Calendar size={22} className="text-accent-action" />}
        title={page.t("radar.empty.filteredTitle")}
        body={page.t("radar.empty.filteredBody")}
      />
    );
  }
  return null;
}

function ShowsResults({ page }: ShowsSectionProps) {
  if (page.loading || !page.hasFollowedArtists || page.filtered.length === 0) {
    return null;
  }

  return (
    <div className="space-y-10">
      <ShowsMonthSection
        icon={<Sparkles size={15} className="text-accent-action" />}
        items={page.comingUp}
        monthTitle={page.t("radar.sections.comingUp")}
        page={page}
      />
      <ShowsMonthSection
        icon={<Calendar size={15} className="text-text-muted" />}
        items={page.recentlyReleased}
        muted
        monthTitle={page.t("radar.sections.recentlyReleased")}
        page={page}
      />
    </div>
  );
}

function ShowsMonthSection({
  icon,
  items,
  monthTitle,
  muted = false,
  page,
}: ShowsSectionProps & {
  icon: ReactNode;
  items: ShowsPageController["comingUp"];
  monthTitle: string;
  muted?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2
          className={cn(
            "text-sm font-semibold uppercase tracking-[0.18em]",
            muted ? "text-text-muted" : "text-accent-action",
          )}
        >
          {monthTitle}
        </h2>
      </div>
      <div className="space-y-8">
        {groupByMonth(items).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={page.expandedId}
            onToggleExpand={page.setExpandedId}
          />
        ))}
      </div>
    </section>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[12px] border border-text-primary/5 bg-text-primary/[0.02] px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-border-quiet bg-text-primary/5">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">{body}</p>
    </div>
  );
}

export function ShowsContent({ page }: ShowsSectionProps) {
  return (
    <div className="space-y-6">
      <ShowsHeader page={page} />
      <ShowsFeatured page={page} />
      <ShowsFilters page={page} />
      <ShowsEmptyStates page={page} />
      <ShowsResults page={page} />
    </div>
  );
}
