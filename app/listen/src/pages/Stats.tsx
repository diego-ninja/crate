import { useMemo, useState } from "react";
import { BarChart3, Clock3, Disc3, Music2, Play, SkipForward, Tag, TrendingUp } from "lucide-react";
import { Link } from "react-router";

import {
  OverviewCard,
  StatsSection,
  TopList,
  TrendChart,
  WindowPicker,
} from "@/components/stats/StatsPanels";
import {
  buildRecapHighlights,
  formatStatsMinutes,
  formatStatsPercent,
  toPlayerTrack,
  type ReplayMix,
  type StatsAlbum,
  type StatsArtist,
  type StatsGenre,
  type StatsListResponse,
  type StatsOverview,
  type StatsTrack,
  type StatsTrends,
  type StatsWindow,
  STATS_WINDOW_OPTIONS,
} from "@/components/stats/stats-model";
import { useApi } from "@/hooks/use-api";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";

export function Stats() {
  const [selectedWindow, setSelectedWindow] = useState<StatsWindow>("30d");
  const { play, playAll } = usePlayerActions();
  const { data: overview, loading: overviewLoading } = useApi<StatsOverview>(`/api/me/stats/overview?window=${selectedWindow}`);
  const { data: trends, loading: trendsLoading } = useApi<StatsTrends>(`/api/me/stats/trends?window=${selectedWindow}`);
  const { data: topTracks, loading: tracksLoading } = useApi<StatsListResponse<StatsTrack>>(`/api/me/stats/top-tracks?window=${selectedWindow}&limit=10`);
  const { data: topArtists, loading: artistsLoading } = useApi<StatsListResponse<StatsArtist>>(`/api/me/stats/top-artists?window=${selectedWindow}&limit=8`);
  const { data: topAlbums, loading: albumsLoading } = useApi<StatsListResponse<StatsAlbum>>(`/api/me/stats/top-albums?window=${selectedWindow}&limit=8`);
  const { data: topGenres, loading: genresLoading } = useApi<StatsListResponse<StatsGenre>>(`/api/me/stats/top-genres?window=${selectedWindow}&limit=8`);
  const { data: replay, loading: replayLoading } = useApi<ReplayMix>(`/api/me/stats/replay?window=${selectedWindow}&limit=30`);

  const topTrackItems = topTracks?.items ?? [];
  const topArtistItems = topArtists?.items ?? [];
  const topAlbumItems = topAlbums?.items ?? [];
  const topGenreItems = topGenres?.items ?? [];
  const replayItems = replay?.items ?? [];
  const recapHighlights = useMemo(
    () => buildRecapHighlights(overview ?? undefined, replay ?? undefined, topArtistItems, topTrackItems),
    [overview, replay, topArtistItems, topTrackItems],
  );

  const playTopTrack = (item: StatsTrack) => {
    const track = toPlayerTrack(item);
    play(track, { type: "track", name: item.title, id: item.track_id ?? item.track_path });
  };

  const playReplay = () => {
    if (!replayItems.length) return;
    playAll(
      replayItems.map(toPlayerTrack),
      0,
      { type: "playlist", name: replay?.title || "Replay" },
    );
  };

  const allSectionsLoaded = !overviewLoading && !trendsLoading && !tracksLoading && !artistsLoading && !albumsLoading && !genresLoading && !replayLoading;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
            <BarChart3 size={12} />
            Stats
          </div>
          <h1 className="mt-3 text-3xl font-bold text-foreground">Your listening, quantified</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A first look at your listening profile across minutes, trends, artists, albums, and tracks.
          </p>
        </div>
        <WindowPicker value={selectedWindow} onChange={setSelectedWindow} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard
            icon={Clock3}
            label="Time listened"
            value={overview ? formatStatsMinutes(overview.minutes_listened) : overviewLoading ? "..." : "0m"}
            hint={overview ? `${overview.active_days} active days` : "Listening time in the selected window"}
          />
        <OverviewCard
          icon={Music2}
          label="Qualified plays"
          value={overview ? String(overview.play_count) : overviewLoading ? "..." : "0"}
          hint={overview ? `${overview.complete_play_count} completed plays` : "Valid plays recorded"}
        />
          <OverviewCard
            icon={SkipForward}
            label="Skip rate"
            value={overview ? formatStatsPercent(overview.skip_rate) : overviewLoading ? "..." : "0%"}
            hint={overview ? `${overview.skip_count} skips` : "Tracks you moved on from"}
          />
        <OverviewCard
          icon={TrendingUp}
          label="Top artist"
          value={overview?.top_artist?.artist_name ?? (overviewLoading ? "..." : "—")}
          hint={overview?.top_artist ? `${overview.top_artist.play_count} plays` : "No artist data yet"}
        />
      </div>

      <StatsSection
        title={replay?.title || "Replay"}
        subtitle={replay?.subtitle || "Turn this listening window into a playable recap."}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Tracks</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{replay?.track_count ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Minutes</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{formatStatsMinutes(replay?.minutes_listened ?? 0)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Window</div>
              <div className="mt-1 text-lg font-semibold text-foreground">
                {STATS_WINDOW_OPTIONS.find((item) => item.value === selectedWindow)?.label ?? selectedWindow}
              </div>
            </div>
          </div>

          <button
            onClick={playReplay}
            disabled={!replayItems.length}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <Play size={14} fill="currentColor" />
            Play replay
          </button>
        </div>

        {replayLoading ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-muted-foreground">
            Loading replay...
          </div>
        ) : replayItems.length > 0 ? (
          <div className="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {replayItems.slice(0, 6).map((item, index) => (
              <button
                key={`${item.track_id ?? item.track_path ?? item.title}-${index}`}
                onClick={() => playTopTrack(item)}
                className="flex items-center gap-3 rounded-xl border border-transparent bg-black/10 px-3 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.artist}</div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-5 text-sm text-muted-foreground">
            Keep listening and your replay object will start to take shape.
          </div>
        )}
      </StatsSection>

      <StatsSection
        title="Your window so far"
        subtitle="A more readable summary of what this period says about your listening."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {recapHighlights.length > 0 ? recapHighlights.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-white/10 bg-black/10 p-4"
            >
              <div className="text-sm font-semibold text-foreground">{item.title}</div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</div>
            </div>
          )) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4 text-sm text-muted-foreground lg:col-span-3">
              Keep listening and this window will start to tell a clearer story.
            </div>
          )}
        </div>
      </StatsSection>

      <StatsSection
        title="Daily trend"
        subtitle="Your listening curve across the selected time window."
      >
        <TrendChart points={trends?.points ?? []} loading={trendsLoading} />
      </StatsSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <StatsSection
          title="Top tracks"
          subtitle="The songs that defined this window."
        >
          <TopList title="Tracks" emptyText="No top tracks yet." loading={tracksLoading}>
            {topTrackItems.map((item, index) => (
              <button
                key={`${item.track_id ?? item.track_path ?? item.title}-${index}`}
                onClick={() => playTopTrack(item)}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.artist} · {item.album}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium text-foreground">{item.play_count}</div>
                  <div className="text-[11px] text-muted-foreground">{formatStatsMinutes(item.minutes_listened)}</div>
                </div>
              </button>
            ))}
          </TopList>
        </StatsSection>

        <StatsSection
          title="Top artists"
          subtitle="Who you kept coming back to."
        >
          <TopList title="Artists" emptyText="No top artists yet." loading={artistsLoading}>
            {topArtistItems.map((item, index) => (
              <Link
                key={`${item.artist_name}-${index}`}
                to={artistPagePath({ artistId: item.artist_id, artistSlug: item.artist_slug })}
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.artist_name}</div>
                  <div className="text-xs text-muted-foreground">{formatStatsMinutes(item.minutes_listened)}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{item.play_count}</div>
              </Link>
            ))}
          </TopList>
        </StatsSection>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <StatsSection
          title="Top albums"
          subtitle="Records that shaped the window."
        >
          <TopList title="Albums" emptyText="No top albums yet." loading={albumsLoading}>
            {topAlbumItems.map((item, index) => (
              <Link
                key={`${item.artist}-${item.album}-${index}`}
                to={albumPagePath({ albumId: item.album_id, albumSlug: item.album_slug })}
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  <Disc3 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.album}</div>
                  <div className="truncate text-xs text-muted-foreground">{item.artist}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-foreground">{item.play_count}</div>
                  <div className="text-[11px] text-muted-foreground">{formatStatsMinutes(item.minutes_listened)}</div>
                </div>
              </Link>
            ))}
          </TopList>
        </StatsSection>

        <StatsSection
          title="Top genres"
          subtitle="Your strongest stylistic pull in this window."
        >
          <TopList title="Genres" emptyText="No top genres yet." loading={genresLoading}>
            {topGenreItems.map((item, index) => (
              <div
                key={`${item.genre_name}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  <Tag size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.genre_name}</div>
                  <div className="text-xs text-muted-foreground">{formatStatsMinutes(item.minutes_listened)}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{item.play_count}</div>
              </div>
            ))}
          </TopList>
        </StatsSection>
      </div>

      {allSectionsLoaded && !overview?.play_count ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center">
          <h2 className="text-lg font-semibold text-foreground">Your stats are waiting for you</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Start listening and this page will turn into your personal listening dashboard.
          </p>
        </div>
      ) : null}
    </div>
  );
}
