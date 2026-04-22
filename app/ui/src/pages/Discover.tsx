import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  BarChart3,
  Compass,
  Disc3,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { Button } from "@crate/ui/shadcn/button";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Input } from "@crate/ui/shadcn/input";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { artistPagePath, artistPhotoApiUrl, albumPagePath } from "@/lib/library-routes";
import { cn, formatCompact } from "@/lib/utils";

interface MissingAlbum {
  title: string;
  type: string;
  year: string;
}

interface ArtistCompleteness {
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  has_photo: boolean;
  listeners: number;
  local_count: number;
  mb_count: number;
  pct: number;
  missing: MissingAlbum[];
}

interface Release {
  id: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_title: string;
  album_id?: number;
  album_slug?: string;
  release_date: string | null;
  release_type: string | null;
  cover_url: string | null;
  status: string;
  tracks: number;
  quality: string;
}

interface InsightsData {
  popularity: { artist: string; popularity: number; listeners: number }[];
  top_albums: { album: string; artist: string; listeners: number; popularity: number; year: string | null }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  completeness: {
    artists_total: number;
    artists_with_photo: number;
    artists_enriched: number;
    albums_total: number;
    albums_with_cover: number;
    tracks_total: number;
    tracks_analyzed: number;
  };
}

function completionTone(pct: number) {
  if (pct >= 100) return "bg-emerald-500";
  if (pct > 75) return "bg-primary";
  if (pct > 50) return "bg-amber-400";
  return "bg-red-400";
}

function OpportunityCard({ artist }: { artist: ArtistCompleteness }) {
  const navigate = useNavigate();
  const href = artist.artist_id != null ? artistPagePath({ artistId: artist.artist_id, artistSlug: artist.artist_slug, artistName: artist.artist }) : undefined;

  return (
    <div className="rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="flex items-start gap-3">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/8 bg-white/[0.04]">
          <img
            src={artistPhotoApiUrl({ artistId: artist.artist_id, artistSlug: artist.artist_slug, artistName: artist.artist })}
            alt={artist.artist}
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
          <User size={18} className="absolute text-white/25" style={{ display: artist.has_photo ? "none" : undefined }} />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            {href ? (
              <Link to={href} className="block truncate text-base font-semibold tracking-tight text-white transition-colors hover:text-primary">
                {artist.artist}
              </Link>
            ) : (
              <div className="truncate text-base font-semibold tracking-tight text-white">{artist.artist}</div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
              <CrateChip>{artist.local_count}/{artist.mb_count} releases</CrateChip>
              <CrateChip>{artist.missing.length} missing</CrateChip>
              {artist.listeners > 0 ? <CrateChip>{formatCompact(artist.listeners)} listeners</CrateChip> : null}
            </div>
          </div>

          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
              <div className={cn("h-full rounded-sm transition-all", completionTone(artist.pct))} style={{ width: `${Math.min(artist.pct, 100)}%` }} />
            </div>
            <div className="text-xs text-white/40">{Math.round(artist.pct)}% discography coverage</div>
          </div>

          {artist.missing.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {artist.missing.slice(0, 3).map((album) => (
                <CrateChip key={`${artist.artist}-${album.title}`}>
                  {album.year || "?"} · {album.title}
                </CrateChip>
              ))}
              {artist.missing.length > 3 ? <CrateChip>+{artist.missing.length - 3} more</CrateChip> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {href ? (
          <Button size="sm" variant="outline" className="gap-2" onClick={() => navigate(href)}>
            <Search size={14} />
            Open artist
          </Button>
        ) : null}
        <Button size="sm" className="gap-2" onClick={() => navigate(`/download?q=${encodeURIComponent(artist.artist)}`)}>
          <Download size={14} />
          Acquire missing
        </Button>
      </div>
    </div>
  );
}

function ReleaseRadarRow({ release }: { release: Release }) {
  const albumHref = release.album_id != null
    ? albumPagePath({
        albumId: release.album_id,
        albumSlug: release.album_slug,
        artistName: release.artist_name,
        albumName: release.album_title,
      })
    : undefined;
  const artistHref = release.artist_id != null
    ? artistPagePath({
        artistId: release.artist_id,
        artistSlug: release.artist_slug,
        artistName: release.artist_name,
      })
    : undefined;

  return (
    <div className="flex items-center gap-3 rounded-sm border border-white/6 bg-black/15 px-3 py-3">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.04]">
        {release.cover_url ? (
          <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={16} className="text-white/20" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {albumHref ? (
          <Link to={albumHref} className="block truncate text-sm font-medium text-white transition-colors hover:text-primary">
            {release.album_title}
          </Link>
        ) : (
          <div className="truncate text-sm font-medium text-white">{release.album_title}</div>
        )}
        {artistHref ? (
          <Link to={artistHref} className="block truncate text-xs text-white/45 transition-colors hover:text-white/80">
            {release.artist_name}
          </Link>
        ) : (
          <div className="truncate text-xs text-white/45">{release.artist_name}</div>
        )}
      </div>
      <div className="hidden shrink-0 md:block">
        <CrateChip>{release.release_type || "release"}</CrateChip>
      </div>
    </div>
  );
}

function PopularityRow({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-white/6 bg-black/15 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-white">{label}</div>
        {secondary ? <div className="truncate text-xs text-white/40">{secondary}</div> : null}
      </div>
      <div className="shrink-0 text-xs font-medium text-white/60">{value}</div>
    </div>
  );
}

export function Discover() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [checking, setChecking] = useState(false);

  const {
    data: completeness,
    loading: completenessLoading,
    error: completenessError,
    refetch: refetchCompleteness,
  } = useApi<ArtistCompleteness[]>("/api/discover/completeness");

  const {
    data: releaseData,
    loading: releasesLoading,
    error: releasesError,
    refetch: refetchReleases,
  } = useApi<{ releases: Release[] }>("/api/acquisition/new-releases?status=detected");

  const {
    data: insights,
    loading: insightsLoading,
    error: insightsError,
    refetch: refetchInsights,
  } = useApi<InsightsData>("/api/insights");

  const normalizedSearch = search.trim().toLowerCase();

  const opportunityArtists = useMemo(() => {
    const source = completeness ?? [];
    return source
      .filter((artist) => artist.pct < 100)
      .filter((artist) => artist.missing.length > 0)
      .filter((artist) => {
        if (!normalizedSearch) return true;
        return `${artist.artist} ${artist.missing.map((album) => album.title).join(" ")}`.toLowerCase().includes(normalizedSearch);
      })
      .sort((a, b) => {
        if ((b.listeners || 0) !== (a.listeners || 0)) return (b.listeners || 0) - (a.listeners || 0);
        return a.pct - b.pct;
      });
  }, [completeness, normalizedSearch]);

  const detectedReleases = useMemo(() => {
    const source = releaseData?.releases ?? [];
    return source.filter((release) => {
      if (!normalizedSearch) return true;
      return `${release.artist_name} ${release.album_title}`.toLowerCase().includes(normalizedSearch);
    });
  }, [normalizedSearch, releaseData?.releases]);

  const trendingArtists = useMemo(() => {
    const source = insights?.popularity ?? [];
    return source
      .filter((row) => !normalizedSearch || row.artist.toLowerCase().includes(normalizedSearch))
      .slice(0, 8);
  }, [insights?.popularity, normalizedSearch]);

  const momentumAlbums = useMemo(() => {
    const source = insights?.top_albums ?? [];
    return source
      .filter((row) => !normalizedSearch || `${row.artist} ${row.album}`.toLowerCase().includes(normalizedSearch))
      .slice(0, 8);
  }, [insights?.top_albums, normalizedSearch]);

  const genreOpportunities = useMemo(() => (insights?.top_genres ?? []).slice(0, 8), [insights?.top_genres]);

  const summary = useMemo(() => {
    const totalArtists = completeness?.length ?? 0;
    const incompleteArtists = (completeness ?? []).filter((artist) => artist.pct < 100).length;
    return {
      totalArtists,
      incompleteArtists,
      detectedReleases: releaseData?.releases?.length ?? 0,
      opportunityArtists: opportunityArtists.length,
    };
  }, [completeness, opportunityArtists.length, releaseData?.releases?.length]);

  async function refreshAll() {
    refetchCompleteness();
    refetchReleases();
    refetchInsights();
  }

  async function recomputeCompleteness() {
    setRecomputing(true);
    try {
      await api("/api/discover/completeness/refresh", "POST");
      toast.success("Completeness refresh queued");
    } catch {
      toast.error("Failed to queue completeness refresh");
    } finally {
      setRecomputing(false);
    }
  }

  async function checkReleases() {
    setChecking(true);
    try {
      await api("/api/acquisition/new-releases/check", "POST");
      toast.success("New release check queued");
    } catch {
      toast.error("Failed to queue release check");
    } finally {
      setChecking(false);
    }
  }

  const loading = completenessLoading && releasesLoading && insightsLoading;
  const hardError = !completeness && completenessError && !releaseData && releasesError && !insights && insightsError;

  if (hardError) {
    return <ErrorState message="Failed to build discovery workspace" onRetry={refreshAll} />;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Compass}
        title="Discovery"
        description="A workspace for finding what to import next: incomplete artist catalogues, fresh releases, momentum signals and genres worth expanding."
        actions={
          <>
            <Button variant="outline" size="sm" className="gap-2" onClick={refreshAll}>
              <RefreshCw size={14} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={recomputeCompleteness} disabled={recomputing}>
              {recomputing ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
              Recompute gaps
            </Button>
            <Button size="sm" className="gap-2" onClick={checkReleases} disabled={checking}>
              {checking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Check releases
            </Button>
          </>
        }
      >
        <CratePill active icon={Compass}>{summary.opportunityArtists} acquisition targets</CratePill>
        <CratePill icon={Sparkles}>{summary.detectedReleases} detected releases</CratePill>
        <CratePill icon={Search}>{summary.incompleteArtists} incomplete artists</CratePill>
        <CratePill icon={TrendingUp}>{trendingArtists.length} momentum signals</CratePill>
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile icon={Search} label="Acquisition targets" value={summary.opportunityArtists.toLocaleString()} caption="Artists with missing catalogue worth filling" tone={summary.opportunityArtists > 0 ? "primary" : "default"} />
        <OpsStatTile icon={Sparkles} label="Detected releases" value={summary.detectedReleases.toLocaleString()} caption="Albums already found by the radar" tone={summary.detectedReleases > 0 ? "success" : "default"} />
        <OpsStatTile icon={Compass} label="Incomplete artists" value={summary.incompleteArtists.toLocaleString()} caption={`${summary.totalArtists.toLocaleString()} artists scanned for catalogue gaps`} tone={summary.incompleteArtists > 0 ? "warning" : "default"} />
        <OpsStatTile icon={TrendingUp} label="Trend signals" value={(trendingArtists.length + momentumAlbums.length).toLocaleString()} caption="Popularity and momentum slices from the library orbit" />
      </div>

      <OpsPanel
        icon={Search}
        title="Search workspace"
        description="Narrow all discovery panels at once by artist, album or missing-release title."
      >
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search artists, releases or missing albums..."
            className="pl-9"
          />
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Download}
        title="Acquisition opportunities"
        description="Artists with enough listener weight and enough missing catalogue to justify a download or curation pass."
      >
        {opportunityArtists.length > 0 ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {opportunityArtists.slice(0, 8).map((artist) => (
              <OpportunityCard key={artist.artist} artist={artist} />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-12 text-center text-sm text-white/35">
            No acquisition opportunities match the current filter.
          </div>
        )}
      </OpsPanel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <OpsPanel
          icon={Sparkles}
          title="Release radar"
          description="Freshly detected albums from your orbit that may deserve immediate acquisition."
          action={
            <Button size="sm" variant="outline" className="gap-2" onClick={() => navigate("/new-releases")}>
              <ExternalLink size={14} />
              Open full radar
            </Button>
          }
        >
          {detectedReleases.length > 0 ? (
            <div className="space-y-2">
              {detectedReleases.slice(0, 8).map((release) => (
                <ReleaseRadarRow key={release.id} release={release} />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-10 text-center text-sm text-white/35">
              No detected releases available right now.
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          icon={BarChart3}
          title="Genres to expand"
          description="Top genres in your library, useful for spotting where a discovery sweep would most naturally fit."
        >
          {genreOpportunities.length > 0 ? (
            <div className="space-y-2">
              {genreOpportunities.map((genre) => (
                <PopularityRow
                  key={genre.genre}
                  label={genre.genre}
                  value={`${genre.artists} artists`}
                  secondary={`${genre.albums} albums`}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-10 text-center text-sm text-white/35">
              Genre expansion data is not available yet.
            </div>
          )}
        </OpsPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <OpsPanel
          icon={TrendingUp}
          title="Artist momentum"
          description="Popularity leaders in your orbit. Not discovery by itself, but a strong hint for what deserves deeper acquisition."
        >
          {trendingArtists.length > 0 ? (
            <div className="space-y-2">
              {trendingArtists.map((artist) => (
                <PopularityRow
                  key={artist.artist}
                  label={artist.artist}
                  value={`${artist.popularity || 0}%`}
                  secondary={artist.listeners ? `${formatCompact(artist.listeners)} listeners` : undefined}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-10 text-center text-sm text-white/35">
              No momentum data available yet.
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          icon={Disc3}
          title="Album momentum"
          description="Albums already resonating in your world. Handy for deciding which artists deserve more catalogue depth."
        >
          {momentumAlbums.length > 0 ? (
            <div className="space-y-2">
              {momentumAlbums.map((album) => (
                <PopularityRow
                  key={`${album.artist}-${album.album}`}
                  label={`${album.artist} · ${album.album}`}
                  value={album.listeners ? formatCompact(album.listeners) : `${album.popularity || 0}%`}
                  secondary={album.year || undefined}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-10 text-center text-sm text-white/35">
              No album momentum data available yet.
            </div>
          )}
        </OpsPanel>
      </div>
    </div>
  );
}
