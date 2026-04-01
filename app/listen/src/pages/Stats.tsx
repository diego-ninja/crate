import { Children, type ReactNode, useMemo, useState } from "react";
import { ResponsiveLine } from "@nivo/line";
import { BarChart3, Clock3, Disc3, Music2, SkipForward, TrendingUp, User2 } from "lucide-react";
import { Link } from "react-router";

import { useApi } from "@/hooks/use-api";
import { usePlayerActions, type Track } from "@/contexts/PlayerContext";

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
  children,
}: {
  title: string;
  emptyText: string;
  children: ReactNode;
}) {
  const hasVisibleItems = Children.count(children) > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-2">
        {hasVisibleItems ? children : <p className="text-sm text-muted-foreground">{emptyText}</p>}
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: StatsTrendPoint[] }) {
  const data = useMemo(() => [
    {
      id: "Minutes",
      data: points.map((point) => ({
        x: point.day,
        y: Number(point.minutes_listened.toFixed(2)),
      })),
    },
  ], [points]);

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

export function Stats() {
  const [window, setWindow] = useState<StatsWindow>("30d");
  const { play } = usePlayerActions();
  const { data: overview, loading: overviewLoading } = useApi<StatsOverview>(`/api/me/stats/overview?window=${window}`);
  const { data: trends, loading: trendsLoading } = useApi<StatsTrends>(`/api/me/stats/trends?window=${window}`);
  const { data: topTracks, loading: tracksLoading } = useApi<StatsListResponse<StatsTrack>>(`/api/me/stats/top-tracks?window=${window}&limit=10`);
  const { data: topArtists, loading: artistsLoading } = useApi<StatsListResponse<StatsArtist>>(`/api/me/stats/top-artists?window=${window}&limit=8`);
  const { data: topAlbums, loading: albumsLoading } = useApi<StatsListResponse<StatsAlbum>>(`/api/me/stats/top-albums?window=${window}&limit=8`);
  const { data: topGenres, loading: genresLoading } = useApi<StatsListResponse<StatsGenre>>(`/api/me/stats/top-genres?window=${window}&limit=8`);

  const topTrackItems = topTracks?.items ?? [];
  const topArtistItems = topArtists?.items ?? [];
  const topAlbumItems = topAlbums?.items ?? [];
  const topGenreItems = topGenres?.items ?? [];

  const playTopTrack = (item: StatsTrack) => {
    const track: Track = {
      id: item.track_path || String(item.track_id || `${item.artist}-${item.title}`),
      title: item.title,
      artist: item.artist,
      album: item.album,
      path: item.track_path || undefined,
      libraryTrackId: item.track_id || undefined,
    };
    play(track, { type: "track", name: item.title, id: item.track_id ?? item.track_path });
  };

  const loading = overviewLoading || trendsLoading || tracksLoading || artistsLoading || albumsLoading || genresLoading;

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
        <WindowPicker value={window} onChange={setWindow} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OverviewCard
          icon={Clock3}
          label="Time listened"
          value={overview ? formatMinutes(overview.minutes_listened) : loading ? "..." : "0m"}
          hint={overview ? `${overview.active_days} active days` : "Listening time in the selected window"}
        />
        <OverviewCard
          icon={Music2}
          label="Qualified plays"
          value={overview ? String(overview.play_count) : loading ? "..." : "0"}
          hint={overview ? `${overview.complete_play_count} completed plays` : "Valid plays recorded"}
        />
        <OverviewCard
          icon={SkipForward}
          label="Skip rate"
          value={overview ? formatPercent(overview.skip_rate) : loading ? "..." : "0%"}
          hint={overview ? `${overview.skip_count} skips` : "Tracks you moved on from"}
        />
        <OverviewCard
          icon={TrendingUp}
          label="Top artist"
          value={overview?.top_artist?.artist_name ?? (loading ? "..." : "—")}
          hint={overview?.top_artist ? `${overview.top_artist.play_count} plays` : "No artist data yet"}
        />
      </div>

      <Section
        title="Daily trend"
        subtitle="Your listening curve across the selected time window."
      >
        <TrendChart points={trends?.points ?? []} />
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title="Top tracks"
          subtitle="The songs that defined this window."
        >
          <TopList title="Tracks" emptyText="No top tracks yet.">
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
          <TopList title="Artists" emptyText="No top artists yet.">
            {topArtistItems.map((item, index) => (
              <Link
                key={`${item.artist_name}-${index}`}
                to={`/artist/${encodeURIComponent(item.artist_name)}`}
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
          <TopList title="Albums" emptyText="No top albums yet.">
            {topAlbumItems.map((item, index) => (
              <Link
                key={`${item.artist}-${item.album}-${index}`}
                to={`/album/${encodeURIComponent(item.artist)}/${encodeURIComponent(item.album)}`}
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
          <TopList title="Genres" emptyText="No top genres yet.">
            {topGenreItems.map((item, index) => (
              <div
                key={`${item.genre_name}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xs font-semibold text-white/45">
                  <User2 size={14} />
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

      {!loading && !overview?.play_count ? (
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
