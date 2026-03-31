import { type ReactNode, useMemo, useState } from "react";
import { Calendar, Loader2, RadioTower, Sparkles } from "lucide-react";

import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  groupByMonth,
  UpcomingMonthGroup,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

interface UpcomingResponse {
  items: UpcomingItem[];
  summary: {
    followed_artists: number;
    show_count: number;
    release_count: number;
  };
}

type Filter = "all" | "shows" | "releases";

export function Shows() {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, loading } = useApi<UpcomingResponse>("/api/me/upcoming");

  const items = data?.items ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    let next = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      next = next.filter(
        (item) =>
          item.artist.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q),
      );
    }
    if (filter === "shows") next = next.filter((item) => item.type === "show");
    if (filter === "releases") next = next.filter((item) => item.type === "release");
    return next;
  }, [filter, items, search]);

  const today = new Date().toISOString().slice(0, 10);
  const comingUp = filtered.filter((item) => item.is_upcoming || item.date >= today);
  const attendingShows = items.filter((item) => item.type === "show" && item.user_attending);
  const nextAttendingShow = attendingShows
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const nextAttendingDate = nextAttendingShow?.date
    ? new Date(`${nextAttendingShow.date}T12:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  const recentlyReleased = filtered
    .filter((item) => item.type === "release" && !item.is_upcoming && item.date < today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const hasFollowedArtists = (summary?.followed_artists ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            <RadioTower size={12} className="text-primary" />
            Upcoming
          </div>
          <h1 className="mt-3 text-3xl font-bold text-foreground">Shows & Upcoming Releases</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
            Everything coming up from the artists you follow: upcoming shows, future releases, and the latest releases you might have missed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary ? (
            <>
              <SummaryPill label="Followed artists" value={summary.followed_artists} />
              <SummaryPill label="Shows" value={summary.show_count} accent="cyan" />
              <SummaryPill label="Releases" value={summary.release_count} accent="cyan" />
              <SummaryPill label="Attending" value={attendingShows.length} accent="cyan" />
            </>
          ) : null}
        </div>
      </div>

      {nextAttendingShow ? (
        <div className="overflow-hidden rounded-[1.5rem] border border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary">
                <Calendar size={12} />
                Attending soon
              </div>
              <h2 className="mt-4 text-2xl font-bold text-foreground">{nextAttendingShow.artist}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {nextAttendingShow.title} · {nextAttendingShow.subtitle}
              </p>
            </div>
            <div className="flex gap-3">
              {nextAttendingDate ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Date</div>
                  <div className="mt-1 text-sm font-semibold text-foreground">{nextAttendingDate}</div>
                </div>
              ) : null}
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Venue</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{nextAttendingShow.title}</div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[1.25rem] border border-white/5 bg-white/[0.02] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "shows", "releases"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                filter === value
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/10 text-white/50 hover:border-white/20 hover:text-foreground",
              )}
            >
              {value === "all" ? "All" : value === "shows" ? "Shows" : "Releases"}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-[280px]">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by artist, venue, city..."
            className="h-11 w-full rounded-2xl border border-white/10 bg-[#0f1016] px-4 text-sm text-foreground placeholder:text-white/25 focus:border-primary/40 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : null}

      {!loading && !hasFollowedArtists ? (
        <EmptyState
          icon={<Sparkles size={22} className="text-primary" />}
          title="Follow some artists to unlock Upcoming"
          body="As soon as you follow artists, you'll see their upcoming shows and new releases here."
        />
      ) : null}

      {!loading && hasFollowedArtists && filtered.length === 0 ? (
        <EmptyState
          icon={<Calendar size={22} className="text-primary" />}
          title="Nothing matches your filters"
          body="Try another search or switch between shows and releases."
        />
      ) : null}

      {!loading && hasFollowedArtists && filtered.length > 0 ? (
        <div className="space-y-10">
          {comingUp.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Coming up</h2>
              </div>
              <div className="space-y-8">
                {groupByMonth(comingUp).map(([month, monthItems]) => (
                  <UpcomingMonthGroup
                    key={month}
                    month={month}
                    items={monthItems}
                    expandedId={expandedId}
                    onToggleExpand={setExpandedId}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {recentlyReleased.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-white/45" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/45">Recently released</h2>
              </div>
              <div className="space-y-8">
                {groupByMonth(recentlyReleased).map(([month, monthItems]) => (
                  <UpcomingMonthGroup
                    key={month}
                    month={month}
                    items={monthItems}
                    expandedId={expandedId}
                    onToggleExpand={setExpandedId}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
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
      ? "border-primary/20 text-primary"
      : "border-white/10 text-white/60";

  return (
    <div className={cn("rounded-2xl border bg-white/[0.03] px-3 py-2", accentClass)}>
      <div className="text-[10px] uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
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
    <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/50">{body}</p>
    </div>
  );
}
