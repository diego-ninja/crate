import { Children, type ReactNode, useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { BarChart3, Clock3, Disc3, Music2, Play, SkipForward, Tag, TrendingUp } from "lucide-react";
import { Link } from "react-router";

import { useApi } from "@/hooks/use-api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";
import { encPath } from "../../../shared/web/utils";

type StatsWindow = "7d" | "30d" | "90d" | "365d" | "all_time";

interface StatsOverview {
  window: StatsWindow;
  play_count: number;
  complete_play_count: number;
  skip_count: number;
  minutes_listened: number;
  active_days: number;
  skip_rate: number;
  top_artist: {
    artist_name: string;
    play_count: number;
    minutes_listened: number;
  } | null;
}

interface StatsTrendPoint {
  day: string;
  play_count: number;
  complete_play_count: number;
  skip_count: number;
  minutes_listened: number;
}

interface StatsTrends {
  window: StatsWindow;
  points: StatsTrendPoint[];
}

interface StatsTrack {
  track_id: number | null;
  track_path: string | null;
  navidrome_id?: string | null;
  title: string;
  artist: string;
  album: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

interface StatsArtist {
  artist_name: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

interface StatsAlbum {
  artist: string;
  album: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

interface StatsGenre {
  genre_name: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

interface StatsListResponse<T> {
  window: StatsWindow;
  items: T[];
}

interface ReplayMix {
  window: StatsWindow;
  title: string;
  subtitle: string;
  track_count: number;
  minutes_listened: number;
  items: StatsTrack[];
}

interface RecapHighlight {
  title: string;
  body: string;
}

const WINDOW_OPTIONS: { value: StatsWindow; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "365d", label: "1Y" },
  { value: "all_time", label: "All time" },
];

function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = Math.round(minutes % 60);
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

function formatPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function OverviewCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/35">{label}</p>
          <p className="mt-3 text-2xl font-bold text-foreground">{value}</p>
          {hint ? <p className="mt-2 text-sm text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function WindowPicker({
  value,
  onChange,
}: {
  value: StatsWindow;
  onChange: (value: StatsWindow) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl border border-white/10 bg-white/[0.03] p-1">
      {WINDOW_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-xl px-3 py-1.5 text-sm transition-colors ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-white/50 hover:text-white hover:bg-white/5"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TopList({
  title,
  emptyText,
  loading = false,
  children,
}: {
  title: string;
  emptyText: string;
  loading?: boolean;
  children: ReactNode;
}) {
  const hasVisibleItems = Children.count(children) > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-2">
        {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : hasVisibleItems ? children : <p className="text-sm text-muted-foreground">{emptyText}</p>}
      </div>
    </div>
  );
}

function TrendChart({ points, loading }: { points: StatsTrendPoint[]; loading?: boolean }) {
  const data = useMemo(() => [
    {
      id: "Minutes",
      data: points.map((point) => ({
        x: point.day,
        y: Number(point.minutes_listened.toFixed(2)),
      })),
    },
  ], [points]);

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 text-sm text-muted-foreground">
        Loading trend data...
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 text-sm text-muted-foreground">
        Start listening and your daily curve will appear here.
      </div>
    );
  }

  return (
    <div className="h-72 rounded-2xl border border-white/10 bg-black/10 p-3">
      <ResponsiveLine
        data={data}
        margin={{ top: 20, right: 20, bottom: 40, left: 50 }}
        xScale={{ type: "point" }}
        yScale={{ type: "linear", min: 0, max: "auto", stacked: false, reverse: false }}
        axisTop={null}
        axisRight={null}
        colors={["#22d3ee"]}
        enableGridX={false}
        pointSize={7}
        pointColor="#22d3ee"
        pointBorderWidth={0}
        useMesh
        theme={{
          text: { fill: "rgba(255,255,255,0.45)", fontSize: 11 },
          axis: {
            ticks: { text: { fill: "rgba(255,255,255,0.35)" } },
            legend: { text: { fill: "rgba(255,255,255,0.35)" } },
            domain: { line: { stroke: "rgba(255,255,255,0.08)" } },
          },
          grid: { line: { stroke: "rgba(255,255,255,0.06)" } },
          crosshair: { line: { stroke: "rgba(255,255,255,0.2)", strokeWidth: 1 } },
          tooltip: {
            container: {
              background: "#0f1117",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "14px",
            },
          },
        }}
        axisBottom={{
          tickRotation: points.length > 14 ? -45 : 0,
          format: (value) => {
            const date = new Date(`${String(value)}T12:00:00`);
            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          },
        }}
        axisLeft={{
          format: (value) => `${Math.round(Number(value))}m`,
        }}
        tooltip={({ point }) => (
          <div className="px-3 py-2">
            <div className="text-xs font-semibold text-white">{String(point.data.xFormatted)}</div>
            <div className="mt-1 text-sm text-cyan-300">{point.data.yFormatted} minutes</div>
          </div>
        )}
      />
    </div>
  );
}

function buildRecapHighlights(
  overview: StatsOverview | undefined,
  replay: ReplayMix | undefined,
  topArtists: StatsArtist[],
  topTracks: StatsTrack[],
): RecapHighlight[] {
  const highlights: RecapHighlight[] = [];

  if (overview?.top_artist?.artist_name) {
    highlights.push({
      title: `${overview.top_artist.artist_name} led this window`,
      body: `${overview.top_artist.play_count} plays and ${formatMinutes(overview.top_artist.minutes_listened)} listened.`,
    });
  }

  if (topTracks[0] && topTracks[0].play_count > 0) {
    highlights.push({
      title: `"${topTracks[0].title}" kept coming back`,
      body: `${topTracks[0].artist} · ${topTracks[0].play_count} plays in this window.`,
    });
  }

  if (overview && overview.play_count > 0) {
    const cadence =
      overview.active_days >= 20
        ? "You've been listening almost every day."
        : overview.active_days >= 10
          ? "This window has had a steady rhythm."
          : "This window is still taking shape.";
    highlights.push({
      title: `${formatMinutes(overview.minutes_listened)} listened`,
      body: `${cadence} ${overview.complete_play_count} completed plays so far.`,
    });
  }

  if (replay?.track_count && replay.track_count > 0) {
    highlights.push({
      title: `${replay.track_count} tracks define this replay`,
      body: `${topArtists.length ? `Spread across ${Math.min(topArtists.length, 8)} key artists.` : "A first replay object is ready to play."}`,
    });
  }

  return highlights.slice(0, 3);
}

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

  const toPlayerTrack = (item: StatsTrack): Track => ({
    id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
    title: item.title,
    artist: item.artist,
    album: item.album,
    path: item.track_path || undefined,
    libraryTrackId: item.track_id || undefined,
    navidromeId: item.navidrome_id || undefined,
  });

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
          value={overview ? formatMinutes(overview.minutes_listened) : overviewLoading ? "..." : "0m"}
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
          value={overview ? formatPercent(overview.skip_rate) : overviewLoading ? "..." : "0%"}
          hint={overview ? `${overview.skip_count} skips` : "Tracks you moved on from"}
        />
        <OverviewCard
          icon={TrendingUp}
          label="Top artist"
          value={overview?.top_artist?.artist_name ?? (overviewLoading ? "..." : "—")}
          hint={overview?.top_artist ? `${overview.top_artist.play_count} plays` : "No artist data yet"}
        />
      </div>

      <Section
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
              <div className="mt-1 text-lg font-semibold text-foreground">{formatMinutes(replay?.minutes_listened ?? 0)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">Window</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{WINDOW_OPTIONS.find((item) => item.value === selectedWindow)?.label ?? selectedWindow}</div>
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
      </Section>

      <Section
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
      </Section>

      <Section
        title="Daily trend"
        subtitle="Your listening curve across the selected time window."
      >
        <TrendChart points={trends?.points ?? []} loading={trendsLoading} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
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
                  <div className="text-[11px] text-muted-foreground">{formatMinutes(item.minutes_listened)}</div>
                </div>
              </button>
            ))}
          </TopList>
        </Section>

        <Section
          title="Top artists"
          subtitle="Who you kept coming back to."
        >
          <TopList title="Artists" emptyText="No top artists yet." loading={artistsLoading}>
            {topArtistItems.map((item, index) => (
              <Link
                key={`${item.artist_name}-${index}`}
                to={`/artist/${encPath(item.artist_name)}`}
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors hover:border-white/10 hover:bg-white/5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">{item.artist_name}</div>
                  <div className="text-xs text-muted-foreground">{formatMinutes(item.minutes_listened)}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{item.play_count}</div>
              </Link>
            ))}
          </TopList>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Top albums"
          subtitle="Records that shaped the window."
        >
          <TopList title="Albums" emptyText="No top albums yet." loading={albumsLoading}>
            {topAlbumItems.map((item, index) => (
              <Link
                key={`${item.artist}-${item.album}-${index}`}
                to={`/album/${encPath(item.artist)}/${encPath(item.album)}`}
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
                  <div className="text-[11px] text-muted-foreground">{formatMinutes(item.minutes_listened)}</div>
                </div>
              </Link>
            ))}
          </TopList>
        </Section>

        <Section
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
                  <div className="text-xs text-muted-foreground">{formatMinutes(item.minutes_listened)}</div>
                </div>
                <div className="text-sm font-medium text-foreground">{item.play_count}</div>
              </div>
            ))}
          </TopList>
        </Section>
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
