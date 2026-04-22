import { useMemo, type ReactNode } from "react";

import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveScatterPlot } from "@nivo/scatterplot";
import {
  BarChart3,
  Disc3,
  Globe,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { ErrorState } from "@crate-ui/primitives/ErrorState";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crate-ui/shadcn/card";
import { useApi } from "@/hooks/use-api";
import { cn, formatNumber } from "@/lib/utils";

interface InsightsData {
  countries: Record<string, number>;
  bpm_distribution: { bpm: string; count: number }[];
  energy_danceability: { x: number; y: number; artist: string; title: string }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  popularity: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
  }[];
  albums_by_decade: Record<string, number>;
  top_albums: {
    album: string;
    artist: string;
    listeners: number;
    popularity: number;
    popularity_score?: number | null;
    year: string | null;
  }[];
  acoustic_instrumental: { x: number; y: number; artist: string; title: string }[];
  feature_coverage: { feature: string; value: number; total: number }[];
  artist_depth: {
    artist: string;
    popularity: number;
    popularity_score?: number | null;
    listeners: number;
    albums: number;
    tracks: number;
  }[];
}

const NIVO_THEME = {
  text: { fill: "#9ca3af" },
  axis: {
    ticks: { text: { fill: "#6b7280", fontSize: 11 } },
    legend: { text: { fill: "#9ca3af", fontSize: 12 } },
  },
  grid: { line: { stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 } },
  tooltip: {
    container: {
      background: "transparent",
      color: "#f5f7fb",
      borderRadius: "0px",
      fontSize: 12,
      border: "none",
      boxShadow: "none",
      padding: 0,
      backdropFilter: "none",
    },
  },
  labels: { text: { fill: "#f3f4f6", fontSize: 11 } },
  legends: { text: { fill: "#9ca3af", fontSize: 11 } },
};

function truncateLabel(value: string, max = 24) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function coveragePct(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-center text-sm text-white/35">
      {message}
    </div>
  );
}

type TooltipMetric = {
  label: string;
  value: string;
};

function ChartTooltip({
  eyebrow,
  title,
  subtitle,
  metrics,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  metrics: TooltipMetric[];
  footer?: string;
}) {
  return (
    <div className="min-w-[220px] rounded-sm border border-white/10 bg-panel-surface/95 px-3 py-3 text-xs text-white shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      {eyebrow ? (
        <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-200/65">
          {eyebrow}
        </div>
      ) : null}
      <div className={cn("space-y-0.5", eyebrow ? "mt-2" : "")}>
        <div className="font-medium leading-tight text-white">{title}</div>
        {subtitle ? <div className="text-[11px] text-white/45">{subtitle}</div> : null}
      </div>
      <div className="mt-3 space-y-1.5">
        {metrics.map((metric) => (
          <div key={`${metric.label}-${metric.value}`} className="flex items-center justify-between gap-4 border-b border-white/6 pb-1 last:border-b-0 last:pb-0">
            <span className="text-white/45">{metric.label}</span>
            <span className="font-medium text-white">{metric.value}</span>
          </div>
        ))}
      </div>
      {footer ? <div className="mt-3 border-t border-white/6 pt-2 text-[10px] text-white/35">{footer}</div> : null}
    </div>
  );
}

function HeroSignalPanel({
  items,
}: {
  items: { label: string; value: string; caption: string }[];
}) {
  return (
    <div className="min-w-[320px] rounded-sm border border-white/10 bg-black/20 p-4 shadow-[0_18px_44px_rgba(0,0,0,0.2)] backdrop-blur-xl">
      <div className="text-[11px] uppercase tracking-[0.16em] text-cyan-200/70">Signal Brief</div>
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="border-b border-white/8 pb-3 last:border-b-0 last:pb-0">
            <div className="text-[11px] uppercase tracking-[0.14em] text-white/35">{item.label}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight text-white">{item.value}</div>
            <div className="mt-1 text-xs text-white/45">{item.caption}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightStoryCard({
  label,
  value,
  caption,
  accent = "primary",
}: {
  label: string;
  value: string;
  caption: string;
  accent?: "primary" | "muted";
}) {
  return (
    <div
      className={cn(
        "rounded-sm border p-4 shadow-[0_18px_44px_rgba(0,0,0,0.16)] backdrop-blur-xl",
        accent === "primary"
          ? "border-cyan-400/16 bg-cyan-400/[0.08]"
          : "border-white/8 bg-black/20",
      )}
    >
      <div className="text-[11px] uppercase tracking-[0.14em] text-white/40">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-2 text-sm leading-relaxed text-white/55">{caption}</div>
    </div>
  );
}

function InsightChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("relative gap-0 overflow-hidden border-white/10 bg-[rgba(12,12,20,0.96)] shadow-[0_18px_44px_rgba(0,0,0,0.22)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-16 before:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)]", className)}>
      <CardHeader className="border-b border-white/6 pb-4">
        <CardTitle className="text-base text-white">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-5">{children}</CardContent>
    </Card>
  );
}

export function Insights() {
  const { data, loading, error, refetch } = useApi<InsightsData>("/api/insights");

  const decadeData = useMemo(() => {
    if (!data?.albums_by_decade) return [];
    return Object.entries(data.albums_by_decade)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([decade, count]) => ({ decade, albums: count }));
  }, [data?.albums_by_decade]);

  const genreData = useMemo(() => {
    return (data?.top_genres ?? []).slice(0, 12).map((genre) => ({
      genre: truncateLabel(genre.genre, 16),
      artists: genre.artists,
      albums: genre.albums,
      fullGenre: genre.genre,
    }));
  }, [data?.top_genres]);

  const countryData = useMemo(() => {
    if (!data?.countries) return [];
    return Object.entries(data.countries)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 12)
      .map(([country, count]) => ({
        country: truncateLabel(country, 14),
        artists: count,
        fullCountry: country,
      }));
  }, [data?.countries]);

  const popularityData = useMemo(() => {
    return (data?.popularity ?? []).slice(0, 12).map((item) => ({
      artist: truncateLabel(item.artist, 20),
      fullArtist: item.artist,
      popularity:
        item.popularity_score != null
          ? Math.round(item.popularity_score * 100)
          : item.popularity,
      listeners: item.listeners,
      albums: item.albums,
    }));
  }, [data?.popularity]);

  const topAlbumData = useMemo(() => {
    return (data?.top_albums ?? []).slice(0, 12).map((album) => ({
      album: truncateLabel(album.album, 22),
      fullAlbum: album.album,
      fullArtist: album.artist,
      popularity:
        album.popularity_score != null
          ? Math.round(album.popularity_score * 100)
          : album.popularity,
      listeners: album.listeners,
      year: album.year ?? "",
    }));
  }, [data?.top_albums]);

  const featureCoverageData = useMemo(() => {
    return (data?.feature_coverage ?? []).map((feature) => ({
      feature: feature.feature,
      coverage: coveragePct(feature.value, feature.total),
      total: feature.total,
      value: feature.value,
    }));
  }, [data?.feature_coverage]);

  const artistDepthSeries = useMemo(() => {
    return [
      {
        id: "artists",
        data: (data?.artist_depth ?? []).map((artist) => ({
          x:
            artist.popularity_score != null
              ? Math.round(artist.popularity_score * 100)
              : artist.popularity,
          y: artist.albums,
          artist: artist.artist,
          tracks: artist.tracks,
          listeners: artist.listeners,
          albums: artist.albums,
        })),
      },
    ];
  }, [data?.artist_depth]);

  const avgFeatureCoverage = useMemo(() => {
    if (!featureCoverageData.length) return 0;
    return Math.round(
      featureCoverageData.reduce((sum, item) => sum + item.coverage, 0) /
        featureCoverageData.length,
    );
  }, [featureCoverageData]);

  const countriesRepresented = Object.keys(data?.countries ?? {}).length;
  const decadesRepresented = Object.keys(data?.albums_by_decade ?? {}).length;
  const surfacedStandouts = (data?.popularity.length ?? 0) + (data?.top_albums.length ?? 0);
  const leadGenre = data?.top_genres[0];
  const leadArtist = data?.popularity[0];
  const leadAlbum = data?.top_albums[0];
  const leadFeature = [...featureCoverageData].sort((a, b) => b.coverage - a.coverage)[0];
  const leadDecade = [...decadeData].sort((a, b) => b.albums - a.albums)[0];
  const heroBriefItems = [
    {
      label: "Dominant genre",
      value: leadGenre?.genre ?? "No data yet",
      caption: leadGenre
        ? `${formatNumber(leadGenre.artists)} artists and ${formatNumber(leadGenre.albums)} albums sit under this tag.`
        : "Genre distribution will sharpen as enrichment fills in taxonomy data.",
    },
    {
      label: "Catalog center",
      value: leadDecade?.decade ?? "No decade data",
      caption: leadDecade
        ? `${formatNumber(leadDecade.albums)} albums make this the densest release era in the library.`
        : "Release-year density appears once enough album dates are present.",
    },
    {
      label: "Strongest standout",
      value: leadArtist?.artist ?? leadAlbum?.album ?? "No standout yet",
      caption: leadArtist
        ? `Leads the consolidated popularity signal across artists.`
        : leadAlbum
          ? `${leadAlbum.artist} currently anchors album-level standout signal.`
          : "Popularity scoring will surface standouts as signals are computed.",
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <OpsPageHero
          icon={BarChart3}
          title="Insights"
          description="Macro patterns across the library, with a cleaner split between collection shape, standouts and audio signature."
        >
          <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Collection shape</span>
          <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Standouts</span>
          <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Audio signature</span>
        </OpsPageHero>
        <GridSkeleton count={6} columns="grid-cols-1 xl:grid-cols-2" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message="Failed to load insights" onRetry={refetch} />;
  }

  if (!data) {
    return (
      <div className="py-16 text-center text-sm text-white/45">
        No insight data available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={BarChart3}
        title="Insights"
        description="A macro read on how the library is shaped, where its weight sits, and how much of the collection is analytically mapped."
        actions={<HeroSignalPanel items={heroBriefItems} />}
      >
        <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Collection shape</span>
        <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Standouts</span>
        <span className="rounded-sm border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/55">Audio signature</span>
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          icon={Globe}
          label="Countries"
          value={formatNumber(countriesRepresented)}
          caption="Artist origins represented in the library"
          tone="primary"
        />
        <OpsStatTile
          icon={Disc3}
          label="Decades"
          value={formatNumber(decadesRepresented)}
          caption="Release decades with real catalog density"
          tone="default"
        />
        <OpsStatTile
          icon={Zap}
          label="Feature Coverage"
          value={`${avgFeatureCoverage}%`}
          caption={`${featureCoverageData.length} analysis signals tracked across the catalog`}
          tone={avgFeatureCoverage >= 70 ? "success" : "warning"}
        />
        <OpsStatTile
          icon={Trophy}
          label="Standouts Surfaced"
          value={formatNumber(surfacedStandouts)}
          caption={`${formatNumber(data.popularity.length)} artists and ${formatNumber(data.top_albums.length)} albums with strong signal`}
          tone="default"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <InsightStoryCard
          label="Most Represented Genre"
          value={leadGenre?.genre ?? "No genre signal yet"}
          caption={
            leadGenre
              ? `${formatNumber(leadGenre.artists)} artists and ${formatNumber(leadGenre.albums)} albums currently shape the strongest taxonomy cluster.`
              : "As genre enrichment lands, this slot will summarize the library's strongest cultural cluster."
          }
          accent="primary"
        />
        <InsightStoryCard
          label="Collection Center of Gravity"
          value={leadDecade?.decade ?? "No decade signal yet"}
          caption={
            leadDecade
              ? `${formatNumber(leadDecade.albums)} albums make this the decade where the catalog feels heaviest.`
              : "This will surface the decade where release density really accumulates."
          }
        />
        <InsightStoryCard
          label="Best-Mapped Feature"
          value={leadFeature ? `${leadFeature.feature} ${leadFeature.coverage}%` : "No feature signal yet"}
          caption={
            leadFeature
              ? `${formatNumber(leadFeature.value)} of ${formatNumber(leadFeature.total)} tracks already carry this analytical signal.`
              : "Feature coverage becomes more informative as analysis jobs fill in the catalog."
          }
        />
      </div>

      <OpsPanel
        icon={Globe}
        title="Collection Shape"
        description="The broad cultural and catalog footprint of the library: genres, countries and decades."
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <InsightChartCard
            title="Genre Footprint"
            description={`Top ${formatNumber(genreData.length)} genres by artist and album depth.`}
          >
            <div className="h-[320px]">
              {genreData.length > 0 ? (
                <ResponsiveBar
                  data={genreData}
                  keys={["artists", "albums"]}
                  indexBy="genre"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 36, left: 136 }}
                  padding={0.24}
                  groupMode="grouped"
                  colors={["#06b6d4", "#67e8f9"]}
                  borderRadius={4}
                  labelSkipWidth={16}
                  labelSkipHeight={16}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  legends={[
                    {
                      dataFrom: "keys",
                      anchor: "bottom-right",
                      direction: "row",
                      translateY: 34,
                      itemWidth: 80,
                      itemHeight: 16,
                      symbolSize: 10,
                    },
                  ]}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ id, value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Genre footprint"
                      title={String((datum as { fullGenre?: string }).fullGenre ?? "")}
                      metrics={[
                        { label: String(id), value: formatNumber(Number(value)) },
                        {
                          label: String(id) === "artists" ? "Albums" : "Artists",
                          value: formatNumber(
                            Number(
                              String(id) === "artists"
                                ? (datum as { albums: number }).albums
                                : (datum as { artists: number }).artists,
                            ),
                          ),
                        },
                      ]}
                      footer="Grouped bars show how broad each genre is across artists versus albums."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="No genre distribution available yet." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Artists by Country"
            description="Where the library is geographically anchored."
          >
            <div className="h-[320px]">
              {countryData.length > 0 ? (
                <ResponsiveBar
                  data={countryData}
                  keys={["artists"]}
                  indexBy="country"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 16, left: 122 }}
                  padding={0.26}
                  colors={["#06b6d4"]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Artist origins"
                      title={String((datum as { fullCountry?: string }).fullCountry ?? "")}
                      metrics={[{ label: "Artists", value: formatNumber(Number(value)) }]}
                      footer="Country coverage depends on artist enrichment, so this chart grows as metadata improves."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Country data appears once artists have been enriched." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Albums by Decade"
            description="Where the collection is densest across release eras."
          >
            <div className="h-[320px]">
              {decadeData.length > 0 ? (
                <ResponsiveBar
                  data={decadeData}
                  keys={["albums"]}
                  indexBy="decade"
                  margin={{ top: 8, right: 16, bottom: 34, left: 48 }}
                  padding={0.28}
                  colors={["#22d3ee"]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickRotation: 0, tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Catalog density"
                      title={String((datum as { decade?: string }).decade ?? "")}
                      metrics={[{ label: "Albums", value: formatNumber(Number(value)) }]}
                      footer="This shows the decade where your release density really concentrates."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Release years need to be present to build decade coverage." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Trophy}
        title="Standouts"
        description="Popularity and catalog depth, using the consolidated scoring model instead of the older Spotify-heavy heuristic."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <InsightChartCard
            title="Artist Momentum"
            description="Artists with the strongest combined popularity signal."
          >
            <div className="h-[340px]">
              {popularityData.length > 0 ? (
                <ResponsiveBar
                  data={popularityData}
                  keys={["popularity"]}
                  indexBy="artist"
                  layout="horizontal"
                  margin={{ top: 8, right: 22, bottom: 16, left: 156 }}
                  padding={0.24}
                  colors={["#06b6d4"]}
                  borderRadius={4}
                  enableLabel={false}
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Artist standout"
                      title={String((datum as { fullArtist?: string }).fullArtist ?? "")}
                      metrics={[
                        { label: "Popularity score", value: formatNumber(Number(value)) },
                        { label: "Listeners", value: formatNumber(Number((datum as { listeners: number }).listeners)) },
                        { label: "Albums in library", value: formatNumber(Number((datum as { albums: number }).albums)) },
                      ]}
                      footer="Artist momentum now comes from the consolidated popularity model, not the older Spotify-heavy heuristic."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Popularity scoring will appear here once artist signals are available." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Album Standouts"
            description="The strongest individual album signals across the catalog."
          >
            <div className="h-[340px]">
              {topAlbumData.length > 0 ? (
                <ResponsiveBar
                  data={topAlbumData}
                  keys={["popularity"]}
                  indexBy="album"
                  layout="horizontal"
                  margin={{ top: 8, right: 22, bottom: 16, left: 164 }}
                  padding={0.24}
                  colors={["#67e8f9"]}
                  borderRadius={4}
                  enableLabel={false}
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Album standout"
                      title={String((datum as { fullAlbum?: string }).fullAlbum ?? "")}
                      subtitle={String((datum as { fullArtist?: string }).fullArtist ?? "")}
                      metrics={[
                        { label: "Popularity score", value: formatNumber(Number(value)) },
                        { label: "Listeners", value: formatNumber(Number((datum as { listeners: number }).listeners)) },
                        { label: "Year", value: (datum as { year?: string | null }).year || "Unknown" },
                      ]}
                      footer="Albums surface here by consolidated score first, with listeners as supporting signal."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Album standouts appear once album-level popularity has been computed." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Artist Depth vs Popularity"
            description="Who is both widely weighted and deeply represented in the collection."
            className="xl:col-span-2"
          >
            <div className="h-[360px]">
              {artistDepthSeries[0]?.data.length ? (
                <ResponsiveScatterPlot
                  data={artistDepthSeries}
                  xScale={{ type: "linear", min: 0, max: 100 }}
                  yScale={{ type: "linear", min: 0, max: "auto" }}
                  margin={{ top: 10, right: 20, bottom: 48, left: 56 }}
                  axisBottom={{
                    legend: "Popularity score",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Albums in library",
                    legendPosition: "middle",
                    legendOffset: -42,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={8}
                  colors={["#06b6d4"]}
                  useMesh={true}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ node }) => {
                    const point = node.data as {
                      artist: string;
                      tracks: number;
                      listeners: number;
                      albums: number;
                      x: number;
                    };
                    return (
                      <ChartTooltip
                        eyebrow="Depth vs popularity"
                        title={point.artist}
                        metrics={[
                          { label: "Popularity score", value: formatNumber(Number(point.x)) },
                          { label: "Albums", value: formatNumber(point.albums) },
                          { label: "Tracks", value: formatNumber(point.tracks) },
                          { label: "Listeners", value: formatNumber(point.listeners) },
                        ]}
                        footer="The upper-right corner is where both library depth and external signal concentrate."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="Artist depth needs album and popularity scoring to line up before it becomes useful." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Sparkles}
        title="Audio Signature"
        description="How much of the library is analytically described, and what that description says about its sonic shape."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <InsightChartCard
            title="Feature Coverage"
            description="Coverage by analysis dimension, not just overall completeness."
          >
            <div className="h-[320px]">
              {featureCoverageData.length > 0 ? (
                <ResponsiveBar
                  data={featureCoverageData}
                  keys={["coverage"]}
                  indexBy="feature"
                  layout="horizontal"
                  margin={{ top: 8, right: 24, bottom: 16, left: 132 }}
                  padding={0.26}
                  colors={["#06b6d4"]}
                  borderRadius={4}
                  enableLabel={true}
                  labelTextColor="#f8fafc"
                  valueScale={{ type: "linear", min: 0, max: 100 }}
                  axisBottom={{ tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Analysis coverage"
                      title={String((datum as { feature?: string }).feature ?? "")}
                      metrics={[
                        { label: "Coverage", value: `${formatNumber(Number(value))}%` },
                        {
                          label: "Tracks with signal",
                          value: `${formatNumber(Number((datum as { value: number }).value))} / ${formatNumber(Number((datum as { total: number }).total))}`,
                        },
                      ]}
                      footer="This turns analysis completeness into per-feature visibility instead of a single blended number."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Feature coverage appears once analysis jobs have populated the catalog." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="BPM Distribution"
            description="The tempo profile of the analyzed part of the library."
          >
            <div className="h-[320px]">
              {data.bpm_distribution.length > 0 ? (
                <ResponsiveBar
                  data={data.bpm_distribution}
                  keys={["count"]}
                  indexBy="bpm"
                  margin={{ top: 8, right: 16, bottom: 38, left: 48 }}
                  padding={0.22}
                  colors={["#22d3ee"]}
                  borderRadius={4}
                  enableLabel={false}
                  axisBottom={{ tickRotation: 0, tickSize: 0, tickPadding: 8 }}
                  axisLeft={{ tickSize: 0, tickPadding: 8 }}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ value, data: datum }) => (
                    <ChartTooltip
                      eyebrow="Tempo bucket"
                      title={String((datum as { bpm?: string }).bpm ?? "")}
                      metrics={[{ label: "Tracks", value: formatNumber(Number(value)) }]}
                      footer="BPM buckets give a fast read on whether the analyzed library clusters in slower, mid-tempo or high-energy bands."
                    />
                  )}
                />
              ) : (
                <ChartEmpty message="Run audio analysis to expose tempo distribution." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Energy vs Danceability"
            description="A fast read on how forceful versus body-moving the library tends to be."
          >
            <div className="h-[340px]">
              {data.energy_danceability.length > 0 ? (
                <ResponsiveScatterPlot
                  data={[{ id: "tracks", data: data.energy_danceability }]}
                  xScale={{ type: "linear", min: 0, max: 1 }}
                  yScale={{ type: "linear", min: 0, max: 1 }}
                  margin={{ top: 10, right: 16, bottom: 48, left: 54 }}
                  axisBottom={{
                    legend: "Energy",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Danceability",
                    legendPosition: "middle",
                    legendOffset: -40,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={6}
                  colors={["#06b6d4"]}
                  useMesh={true}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ node }) => {
                    const point = node.data as { title?: string; artist?: string };
                    return (
                      <ChartTooltip
                        eyebrow="Audio profile"
                        title={String(point.title ?? "Track")}
                        subtitle={String(point.artist ?? "Unknown artist")}
                        metrics={[
                          { label: "Energy", value: formatNumber(Number((node.data as { x?: number }).x ?? 0)) },
                          { label: "Danceability", value: formatNumber(Number((node.data as { y?: number }).y ?? 0)) },
                        ]}
                        footer="This overlay uses the same structure as the rest of Insights, so audio scatters no longer fall back to a legacy tooltip."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="This scatter appears once tracks have audio features." />
              )}
            </div>
          </InsightChartCard>

          <InsightChartCard
            title="Acousticness vs Instrumentalness"
            description="The balance between organic texture and vocal/instrumental bias."
          >
            <div className="h-[340px]">
              {data.acoustic_instrumental.length > 0 ? (
                <ResponsiveScatterPlot
                  data={[{ id: "tracks", data: data.acoustic_instrumental }]}
                  xScale={{ type: "linear", min: 0, max: 1 }}
                  yScale={{ type: "linear", min: 0, max: 1 }}
                  margin={{ top: 10, right: 16, bottom: 48, left: 54 }}
                  axisBottom={{
                    legend: "Acousticness",
                    legendPosition: "middle",
                    legendOffset: 36,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  axisLeft={{
                    legend: "Instrumentalness",
                    legendPosition: "middle",
                    legendOffset: -40,
                    tickSize: 0,
                    tickPadding: 8,
                  }}
                  nodeSize={6}
                  colors={["#67e8f9"]}
                  useMesh={true}
                  theme={NIVO_THEME}
                  motionConfig="gentle"
                  tooltip={({ node }) => {
                    const point = node.data as { title?: string; artist?: string };
                    return (
                      <ChartTooltip
                        eyebrow="Audio profile"
                        title={String(point.title ?? "Track")}
                        subtitle={String(point.artist ?? "Unknown artist")}
                        metrics={[
                          { label: "Acousticness", value: formatNumber(Number((node.data as { x?: number }).x ?? 0)) },
                          { label: "Instrumentalness", value: formatNumber(Number((node.data as { y?: number }).y ?? 0)) },
                        ]}
                        footer="This makes it much easier to distinguish organic, vocal and instrumental outliers without losing context."
                      />
                    );
                  }}
                />
              ) : (
                <ChartEmpty message="This view fills in once acoustic and instrumental signals are present." />
              )}
            </div>
          </InsightChartCard>
        </div>
      </OpsPanel>
    </div>
  );
}
