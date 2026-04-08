import { Clock3, Play, Sparkles } from "lucide-react";

import { TrackCoverThumb } from "@/components/cards/TrackCoverThumb";
import type { Track } from "@/contexts/PlayerContext";
import { albumCoverApiUrl } from "@/lib/library-routes";

import type { ReplayMix, ReplayTrack } from "./home-model";
import { ContinueListeningCard, SectionHeader, SectionRail } from "./HomeSections";

function replayCoverUrl(item: ReplayTrack): string | undefined {
  if (item.album_id == null) return undefined;
  return albumCoverApiUrl({
    albumId: item.album_id,
    albumSlug: item.album_slug ?? undefined,
    artistName: item.artist,
    albumName: item.album,
  });
}

export function ContinueListeningSection({
  continueLead,
  continueRail,
  onPlayTrack,
}: {
  continueLead?: Track;
  continueRail: Track[];
  onPlayTrack: (track: Track, sourceName: string) => void;
}) {
  if (!continueLead) {
    return (
      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.18),transparent_50%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6">
        <div className="max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-primary">
            <Sparkles size={12} />
            Start listening
          </div>
          <h2 className="text-2xl font-bold text-foreground">Your home should feel alive as soon as playback starts.</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Play an album, a playlist, or a curated mix and this screen will turn into your real listening surface:
            continuity, smart picks, and system playlists from Crate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <ContinueListeningCard
        track={continueLead}
        onPlay={() => onPlayTrack(continueLead, "Continue Listening")}
      />

      <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
          <Clock3 size={12} />
          Recent listens
        </div>
        <div className="space-y-1">
          {continueRail.length > 0 ? continueRail.slice(0, 4).map((track) => (
            <button
              key={track.id}
              onClick={() => onPlayTrack(track, "Recent Listening")}
              className="group/row flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/5"
            >
              <div className="relative h-11 w-11 shrink-0">
                <TrackCoverThumb
                  src={track.albumCover}
                  iconSize={16}
                  className="absolute inset-0 rounded-xl"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover/row:bg-black/45">
                  <Play
                    size={15}
                    fill="currentColor"
                    className="text-white opacity-0 transition-opacity group-hover/row:opacity-100"
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{track.title}</div>
                <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
              </div>
            </button>
          )) : (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-muted-foreground">
              Start playing music and your listening history will show up here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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
  if (!replayPreview.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={replay?.title || "Replay this month"}
        subtitle={replay?.subtitle || "A playable recap of your current listening window."}
        actionLabel="Open Stats"
        onAction={onOpenStats}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
            <Sparkles size={12} />
            Replay
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground">{replay?.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{replay?.subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Tracks</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{replay?.track_count ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Time listened</div>
              <div className="mt-1 text-sm font-semibold text-foreground">
                {Math.round(replay?.minutes_listened ?? 0)}m
              </div>
            </div>
          </div>
          <button
            onClick={onPlayReplay}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Play size={15} fill="currentColor" />
            Play replay
          </button>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
            <Clock3 size={12} />
            Replay picks
          </div>
          <div className="space-y-1">
            {replayPreview.map((item) => (
              <button
                key={`${item.track_id ?? item.track_path ?? item.title}`}
                onClick={() => onPlayTrack(item)}
                className="group/row flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/5"
              >
                <div className="relative h-11 w-11 shrink-0">
                  <TrackCoverThumb
                    src={replayCoverUrl(item)}
                    iconSize={16}
                    className="absolute inset-0 rounded-xl"
                  />
                  <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 transition-colors group-hover/row:bg-black/45">
                    <Play
                      size={15}
                      fill="currentColor"
                      className="text-white opacity-0 transition-opacity group-hover/row:opacity-100"
                    />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.artist}</div>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/45">
                  {item.play_count}×
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function KeepQueueMovingSection({
  tracks,
  onPlayTrack,
}: {
  tracks: Track[];
  onPlayTrack: (track: Track) => void;
}) {
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Keep the queue moving"
        subtitle="Quick picks from your own recent listening."
      />
      <SectionRail>
        {tracks.map((track) => (
          <button
            key={track.id}
            onClick={() => onPlayTrack(track)}
            className="group w-[220px] flex-shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] text-left"
          >
            <div className="flex items-center gap-3 p-3">
              <div className="relative h-16 w-16 shrink-0">
                <TrackCoverThumb
                  src={track.albumCover}
                  iconSize={18}
                  className="absolute inset-0 rounded-2xl"
                />
                <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 transition-colors group-hover:bg-black/45">
                  <Play
                    size={18}
                    fill="currentColor"
                    className="text-white opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{track.title}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{track.artist}</div>
                {track.album ? <div className="mt-1 truncate text-[11px] text-white/35">{track.album}</div> : null}
              </div>
            </div>
          </button>
        ))}
      </SectionRail>
    </section>
  );
}
