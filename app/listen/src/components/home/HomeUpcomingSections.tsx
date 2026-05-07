import { Calendar, Play, RadioTower, Sparkles } from "lucide-react";

import type { HomeUpcomingInsight, HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { SectionHeader, UpcomingPreviewRow } from "./HomeSections";

function formatUpcomingDate(date?: string): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

function insightLabel(type: HomeUpcomingInsight["type"]): string {
  if (type === "show_prep") return "Show prep";
  if (type === "one_week") return "This week";
  return "One month";
}

export function HomeUpcomingSection({
  previewItems,
  summary,
  onOpenUpcoming,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
}) {
  const nextUpcoming = previewItems[0] || null;
  if (!nextUpcoming) return null;

  const nextUpcomingDate = formatUpcomingDate(nextUpcoming.date);

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Upcoming"
        subtitle="Next shows and releases from the artists you follow."
        actionLabel="Open Upcoming"
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            <RadioTower size={12} />
            From your artists
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {nextUpcoming.type === "show" ? "Next show" : "Next release"}
            </div>
            {nextUpcoming.user_attending && nextUpcoming.type === "show" ? (
              <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary">
                Going
              </div>
            ) : null}
          </div>

          <h2 className="mt-4 text-2xl font-bold text-foreground">
            {nextUpcoming.type === "show" ? nextUpcoming.artist : nextUpcoming.title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {nextUpcoming.type === "show"
              ? `${nextUpcoming.title} · ${nextUpcoming.subtitle}`
              : `${nextUpcoming.artist} · ${nextUpcoming.subtitle}`}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {nextUpcomingDate ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Date</div>
                <div className="mt-1 text-sm font-semibold text-foreground">{nextUpcomingDate}</div>
              </div>
            ) : null}
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Shows</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{summary?.show_count ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">Releases</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{summary?.release_count ?? 0}</div>
            </div>
          </div>

          <button
            onClick={onOpenUpcoming}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Calendar size={15} />
            View details
          </button>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
            <Calendar size={12} />
            Next up
          </div>
          <div className="space-y-1">
            {previewItems.map((item) => (
              <UpcomingPreviewRow
                key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
                item={item}
                onClick={onOpenUpcoming}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomeShowPrepSection({
  insights,
  onOpenUpcoming,
  onPlaySetlist,
  onSaveReminder,
}: {
  insights: HomeUpcomingInsight[];
  onOpenUpcoming: () => void;
  onPlaySetlist: (insight: HomeUpcomingInsight) => void;
  onSaveReminder: (insight: HomeUpcomingInsight) => void;
}) {
  if (!insights.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Show prep"
        subtitle="A couple of timely prompts from the shows you're planning to attend."
        actionLabel="Open Upcoming"
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.type}:${insight.show_id}`}
            className="rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_42%),rgba(255,255,255,0.03)] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                  <Sparkles size={12} />
                  {insightLabel(insight.type)}
                </div>
                <h3 className="mt-3 text-lg font-bold text-foreground">{insight.title}</h3>
                <p className="mt-1 text-sm text-white/60">{insight.subtitle}</p>
              </div>
              {insight.weight === "high" ? (
                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-primary">
                  Heavy rotation
                </div>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">{insight.message}</p>

            <div className="mt-5 flex flex-wrap gap-2">
              {insight.has_setlist ? (
                <button
                  onClick={() => onPlaySetlist(insight)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Play size={14} fill="currentColor" />
                  Play probable setlist
                </button>
              ) : null}
              <button
                onClick={() => onSaveReminder(insight)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/20 hover:text-foreground"
              >
                <Calendar size={14} />
                Save for later
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
