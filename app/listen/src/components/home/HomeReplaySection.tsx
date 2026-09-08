import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { Clock3, Play, Sparkles } from "@crate/ui/icons";

import { SectionHeader } from "./HomeSections";
import { HomeReplayRowAction } from "./HomeReplayRowAction";
import type { ReplayMix, ReplayTrack } from "./home-model";

export function HomeReplaySection({
  replay,
  replayPreview,
  onOpenStats,
  onPlayReplay,
  onPlayTrack,
}: {
  replay?: ReplayMix;
  replayPreview: ReplayTrack[];
  onOpenStats: () => void;
  onPlayReplay: () => void;
  onPlayTrack: (track: ReplayTrack) => void;
}) {
  const isDesktop = useIsDesktop();
  if (!replayPreview.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Crate DNA"
        subtitle={
          replay?.title && replay?.subtitle
            ? `${replay.title} · ${replay.subtitle}`
            : "Your current month in Crate, with a playable replay."
        }
        actionLabel={isDesktop ? "Open Pulse" : undefined}
        onAction={isDesktop ? onOpenStats : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="home-replay-card overflow-hidden rounded-[12px] p-5">
          <div className="home-replay-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]">
            <Sparkles size={12} />
            Crate DNA
          </div>
          <h2 className="mt-4 text-2xl font-bold text-text-primary">
            {replay?.title || "This month"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {replay?.subtitle || "A playable recap of your current month."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-xs uppercase tracking-[0.16em]">
                Tracks
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {replay?.track_count ?? 0}
              </div>
            </div>
            <div className="home-replay-metric-card rounded-lg px-3 py-2">
              <div className="home-replay-metric-label text-xs uppercase tracking-[0.16em]">
                Time listened
              </div>
              <div className="mt-1 text-sm font-semibold text-text-primary">
                {Math.round(replay?.minutes_listened ?? 0)}m
              </div>
            </div>
          </div>
          <button
            onClick={onPlayReplay}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
          >
            <Play size={15} fill="currentColor" />
            Play month replay
          </button>
        </div>

        <div className="home-replay-panel overflow-hidden rounded-[12px] p-4">
          <div className="home-replay-panel-kicker mb-3 flex items-center gap-2 text-xs uppercase tracking-wider">
            <Clock3 size={12} />
            Month replay
          </div>
          <div className="space-y-1">
            {replayPreview.map((item) => (
              <HomeReplayRowAction
                key={`${item.track_id ?? item.track_path ?? item.title}`}
                item={item}
                onPlay={() => onPlayTrack(item)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
