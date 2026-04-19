import { useState, useMemo, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { GenreNetworkGraph } from "@/components/genres/GenreNetworkGraph";
import { GenreEqEditor } from "@/components/genres/GenreEqEditor";
import { GenreTaxonomyTree } from "@/components/genres/GenreTaxonomyTree";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { albumCoverApiUrl, albumPagePath, artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { Search, Sparkles, Tag, Disc3, Users, ArrowLeft, Loader2, AlertTriangle, LayoutGrid, ListMusic, Network } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/error-state";

interface Genre {
  id: number;
  name: string;
  slug: string;
  artist_count: number;
  album_count: number;
  description?: string | null;
  external_description?: string | null;
  external_description_source?: string | null;
  musicbrainz_mbid?: string | null;
  wikidata_entity_id?: string | null;
  wikidata_url?: string | null;
  mapped?: boolean;
  canonical_slug?: string | null;
  canonical_name?: string | null;
  canonical_description?: string | null;
  top_level_slug?: string | null;
  top_level_name?: string | null;
  top_level_description?: string | null;
  eq_gains?: number[] | null;
  eq_preset_resolved?: {
    gains: number[];
    source: "direct" | "inherited";
    slug: string;
    name: string;
  } | null;
}

interface GenreDetail extends Genre {
  artists: {
    artist_name: string;
    artist_id?: number;
    artist_slug?: string;
    weight: number;
    source: string;
    album_count: number;
    track_count: number;
    has_photo: number;
    spotify_popularity: number | null;
    listeners: number | null;
  }[];
  albums: {
    album_id: number;
    album_slug?: string;
    weight: number;
    artist: string;
    artist_id?: number;
    artist_slug?: string;
    name: string;
    year: string | null;
    track_count: number;
    has_cover: number;
  }[];
}

interface InvalidTaxonomyNode {
  slug: string;
  name?: string | null;
  alias_count?: number;
  edge_count?: number;
  reason?: string | null;
}

interface InvalidTaxonomyStatus {
  invalid_count: number;
  alias_count: number;
  edge_count: number;
  items: InvalidTaxonomyNode[];
}

// ── Task action helper ─────────────────────────────────────────

function useGenreTask(
  pollTask: ReturnType<typeof useTaskPoll>["pollTask"],
  afterSuccess?: () => void,
) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const run = useCallback(
    async (
      key: string,
      url: string,
      body: Record<string, unknown>,
      opts: {
        successMessage: (result: Record<string, unknown>) => string;
        errorMessage: string;
        pollInterval?: number;
        pollTimeout?: number;
      },
    ) => {
      if (busy[key]) return;
      setBusy((prev) => ({ ...prev, [key]: true }));
      try {
        const { task_id } = await api<{ task_id: string }>(url, "POST", body);
        pollTask(
          task_id,
          (result) => {
            setBusy((prev) => ({ ...prev, [key]: false }));
            afterSuccess?.();
            toast.success(opts.successMessage(result || {}));
          },
          (error) => {
            setBusy((prev) => ({ ...prev, [key]: false }));
            toast.error(error || opts.errorMessage);
          },
          opts.pollInterval ?? 3000,
          opts.pollTimeout ?? 30 * 60 * 1000,
        );
      } catch {
        setBusy((prev) => ({ ...prev, [key]: false }));
        toast.error(opts.errorMessage);
      }
    },
    [busy, pollTask, afterSuccess],
  );

  const isBusy = useCallback((key: string) => !!busy[key], [busy]);
  return { run, isBusy };
}

function TaskButton({
  label,
  busy,
  onClick,
  icon: Icon = Sparkles,
  variant = "outline",
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  icon?: typeof Sparkles;
  variant?: "outline" | "default";
}) {
  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 size={14} className="animate-spin mr-1" /> : <Icon size={14} className="mr-1" />}
      {label}
    </Button>
  );
}

// ── Genre List ──────────────────────────────────────────────────

export function Genres() {
  const { slug } = useParams<{ slug?: string }>();

  if (slug) return <GenreView slug={slug} />;
  return <GenreList />;
}

function GenreList() {
  const { data: genres, loading, error, refetch } = useApi<Genre[]>("/api/genres");
  const { data: unmappedGenres, refetch: refetchUnmapped } = useApi<Genre[]>("/api/genres/unmapped?limit=100");
  const { data: invalidTaxonomy, refetch: refetchInvalidTaxonomy } = useApi<InvalidTaxonomyStatus>("/api/genres/taxonomy/invalid?limit=8");
  const { pollTask } = useTaskPoll();
  const [filter, setFilter] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "tree">("grid");
  const navigate = useNavigate();

  const afterSuccess = useCallback(() => { refetch(); refetchUnmapped(); refetchInvalidTaxonomy(); }, [refetch, refetchUnmapped, refetchInvalidTaxonomy]);
  const { run, isBusy } = useGenreTask(pollTask, afterSuccess);

  const filtered = useMemo(() => {
    if (!genres) return [];
    return genres
      .filter((g) => g.name.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => b.artist_count - a.artist_count);
  }, [genres, filter]);

  async function reindex() {
    setIndexing(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/genres/index", "POST");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setIndexing(false);
            toast.success("Genres re-indexed");
            window.location.reload();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setIndexing(false);
            toast.error("Genre indexing failed");
          }
        } catch { /* polling */ }
      }, 2000);
    } catch { setIndexing(false); toast.error("Failed to start indexing"); }
  }

  if (error) return <ErrorState message="Failed to load genres" onRetry={refetch} />;
  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">Genres</h1>
        <GridSkeleton count={12} columns="grid-cols-4" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tag size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Genres</h1>
          {genres && <span className="text-sm text-muted-foreground">({genres.length})</span>}
          {invalidTaxonomy && (
            <Badge
              variant="outline"
              className={
                invalidTaxonomy.invalid_count > 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              }
            >
              {invalidTaxonomy.invalid_count > 0 ? `${invalidTaxonomy.invalid_count} invalid nodes` : "taxonomy clean"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <TaskButton
            label="Sync MusicBrainz"
            busy={isBusy("mb-sync")}
            onClick={() => run("mb-sync", "/api/genres/musicbrainz/sync", { limit: 80 }, {
              successMessage: (r) => `MusicBrainz sync: ${r.edges_synced ?? 0} edges, ${r.matched_musicbrainz ?? 0} matched`,
              errorMessage: "MusicBrainz sync failed",
              pollTimeout: 60 * 60 * 1000,
            })}
          />
          <TaskButton
            label="Enrich descriptions"
            busy={isBusy("enrich")}
            onClick={() => run("enrich", "/api/genres/descriptions/enrich", { limit: 160 }, {
              successMessage: (r) => `Enrichment: ${r.updated ?? 0} updated, ${r.remaining_without_external ?? 0} missing`,
              errorMessage: "Description enrichment failed",
              pollTimeout: 45 * 60 * 1000,
            })}
          />
          <TaskButton
            label="Infer taxonomy"
            busy={isBusy("infer")}
            onClick={() => run("infer", "/api/genres/infer", { limit: 250, aggressive: true, include_external: true }, {
              successMessage: (r) => `Inference: ${r.mapped ?? 0} mapped, ${r.remaining_unmapped ?? 0} unmapped`,
              errorMessage: "Taxonomy inference failed",
            })}
          />
          <TaskButton
            label="Clean invalid nodes"
            busy={isBusy("cleanup-invalid")}
            onClick={() => run("cleanup-invalid", "/api/genres/taxonomy/cleanup-invalid", {}, {
              successMessage: (r) => `Cleanup: ${r.deleted_count ?? 0} invalid nodes removed`,
              errorMessage: "Genre taxonomy cleanup failed",
            })}
            icon={AlertTriangle}
          />
          <TaskButton label="Re-index" busy={indexing} onClick={reindex} icon={Tag} />
        </div>
      </div>

      {!!invalidTaxonomy?.invalid_count && (
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(120,53,15,0.08))] p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-300" />
            <div className="font-semibold text-foreground">Taxonomy cleanup recommended</div>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-100">
              {invalidTaxonomy.invalid_count} invalid nodes
            </Badge>
            <Badge variant="outline" className="border-amber-500/30 bg-black/10 text-amber-50">
              {invalidTaxonomy.alias_count} aliases
            </Badge>
            <Badge variant="outline" className="border-amber-500/30 bg-black/10 text-amber-50">
              {invalidTaxonomy.edge_count} edges
            </Badge>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            MusicBrainz syncs previously stored malformed taxonomy nodes. You can remove them safely with the cleanup task.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {invalidTaxonomy.items.map((item) => (
              <div
                key={`invalid-taxonomy-${item.slug}`}
                className="rounded-xl border border-amber-500/20 bg-black/10 px-3 py-2"
              >
                <div className="truncate text-sm font-medium text-foreground">{item.name || item.slug}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.reason?.replace(/-/g, " ") || "invalid node"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-6">
        <div className="relative max-w-sm flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter genres..."
            className="pl-9 bg-card border-border"
          />
        </div>
        <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${viewMode === "tree" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Network size={14} />
          </button>
        </div>
      </div>

      {viewMode === "tree" ? (
        <GenreTaxonomyTree filter={filter} />
      ) : (
      <>
      {(unmappedGenres?.length || 0) > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.15),rgba(120,53,15,0.08))] p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-300" />
            <div className="font-semibold text-foreground">Needs taxonomy mapping</div>
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-100">
              {unmappedGenres!.length}
            </Badge>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            Genres from tags or MusicBrainz that still sit outside the curated graph. Run inference to map them.
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {unmappedGenres!.slice(0, 12).map((genre) => (
              <button
                key={`unmapped-${genre.slug}`}
                onClick={() => navigate(`/genres/${genre.slug}`)}
                className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-black/10 px-3 py-2 text-left transition-colors hover:bg-black/20"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{genre.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {genre.artist_count} artists · {genre.album_count} albums
                  </div>
                </div>
                <Badge variant="outline" className="border-amber-500/30 text-amber-100">
                  unmapped
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {genres?.length === 0 ? (
            <div className="space-y-3">
              <p>No genres indexed yet.</p>
              <Button onClick={reindex} disabled={indexing}>Index Genres</Button>
            </div>
          ) : "No genres match your filter."}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((g) => (
            <button
              key={g.id}
              onClick={() => navigate(`/genres/${g.slug}`)}
              className={`text-left rounded-lg border p-4 transition-colors hover:bg-white/[0.04] ${
                g.mapped ? "border-white/8 hover:border-primary/30" : "border-amber-500/30"
              }`}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="font-semibold text-foreground text-sm truncate">{g.name}</div>
                <Badge
                  variant="outline"
                  className={g.mapped ? "border-primary/30 bg-primary/10 text-primary" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}
                >
                  {g.mapped ? "mapped" : "unmapped"}
                </Badge>
              </div>
              {g.canonical_name && g.canonical_name !== g.name && (
                <div className="mb-1 truncate text-[11px] text-white/70">
                  Canonical: {g.canonical_name}
                </div>
              )}
              {g.top_level_name && (
                <div className="mb-1 truncate text-[11px] text-white/55">
                  Family: {g.top_level_name}
                </div>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1.5">
                <span className="flex items-center gap-1"><Users size={11} />{g.artist_count}</span>
                <span className="flex items-center gap-1"><Disc3 size={11} />{g.album_count}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ── Genre Detail View ───────────────────────────────────────────

function GenreView({ slug }: { slug: string }) {
  const { data: genre, loading, refetch } = useApi<GenreDetail>(`/api/genres/${slug}`);
  const { pollTask } = useTaskPoll();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);

  const afterSuccess = useCallback(() => { refetch(); setGraphVersion((v) => v + 1); }, [refetch]);
  const { run, isBusy } = useGenreTask(pollTask, afterSuccess);

  async function createSmartPlaylist() {
    if (!genre) return;
    setCreating(true);
    try {
      const { id } = await api<{ id: number }>("/api/playlists", "POST", {
        name: `${genre.name} Mix`,
        is_smart: true,
        smart_rules: {
          match: "all",
          rules: [{ field: "genre", op: "contains", value: genre.name }],
          limit: 50,
          sort: "random",
        },
      });
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success(`Created "${genre.name} Mix" playlist`);
      navigate("/playlists");
    } catch { toast.error("Failed to create playlist"); } finally { setCreating(false); }
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-6">
          <Button variant="ghost" size="sm" onClick={() => navigate("/genres")}>
            <ArrowLeft size={14} className="mr-1" /> Genres
          </Button>
        </div>
        <GridSkeleton count={6} columns="grid-cols-3" />
      </div>
    );
  }

  if (!genre) {
    return (
      <div className="text-center py-12 text-muted-foreground">Genre not found</div>
    );
  }

  const description =
    genre.description ||
    genre.canonical_description ||
    (genre.mapped
      ? "Curated genre node inside your taxonomy graph."
      : "Raw library tag detected in your collection but not yet linked into the curated taxonomy.");
  const aliasNote =
    genre.canonical_name && genre.canonical_name !== genre.name
      ? `${genre.name} is currently treated as an alias of ${genre.canonical_name}.`
      : null;
  const externalDescription = genre.external_description?.trim();
  const externalSource = genre.external_description_source?.trim();

  return (
    <div>
      {/* Back */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/genres")}>
          <ArrowLeft size={14} className="mr-1" /> Genres
        </Button>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{genre.name}</h1>
            <div className="mt-2 flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Users size={14} />{genre.artists.length} artists</span>
              <span className="flex items-center gap-1.5"><Disc3 size={14} />{genre.albums.length} albums</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={genre.mapped ? "border-primary/30 bg-primary/10 text-primary" : "border-amber-500/30 bg-amber-500/10 text-amber-100"}
            >
              {genre.mapped ? "Mapped" : "Unmapped"}
            </Badge>
            {genre.canonical_name && genre.canonical_name !== genre.name && (
              <Badge variant="outline" className="border-white/10 text-white/70">
                → {genre.canonical_name}
              </Badge>
            )}
            {genre.top_level_name && (
              <Badge variant="outline" className="border-white/10 text-white/60">
                {genre.top_level_name}
              </Badge>
            )}
          </div>
        </div>

        {/* Description + References */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] mb-5">
          <div>
            <p className="text-sm leading-6 text-white/65">{description}</p>
            {aliasNote && <p className="mt-2 text-xs text-white/50 italic">{aliasNote}</p>}
            {externalDescription && (
              <div className="mt-3 rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <p className="text-xs leading-5 text-white/60">{externalDescription}</p>
                {externalSource && (
                  <div className="mt-1.5 text-[10px] text-white/35">Source: {externalSource}</div>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {genre.musicbrainz_mbid && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/40">MBID</span>
                <a
                  href={`https://musicbrainz.org/genre/${genre.musicbrainz_mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-cyan-300/70 hover:text-cyan-200 transition-colors"
                >
                  {genre.musicbrainz_mbid}
                </a>
              </div>
            )}
            {genre.wikidata_url && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/40">Wikidata</span>
                <a
                  href={genre.wikidata_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300/70 hover:text-cyan-200 transition-colors"
                >
                  {genre.wikidata_url.split("/").pop()}
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40">Slug</span>
              <span className="font-mono text-[11px] text-white/50">{genre.slug}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <TaskButton
            label="Sync MusicBrainz"
            busy={isBusy("mb-sync")}
            onClick={() => run("mb-sync", "/api/genres/musicbrainz/sync", {
              focus_slug: genre.canonical_slug || genre.slug, limit: 1, force: true,
            }, {
              successMessage: (r) => `MusicBrainz sync: ${r.edges_synced ?? 0} edges`,
              errorMessage: "MusicBrainz sync failed",
              pollTimeout: 60 * 60 * 1000,
            })}
          />
          <TaskButton
            label="Enrich Description"
            busy={isBusy("enrich")}
            onClick={() => run("enrich", "/api/genres/descriptions/enrich", {
              focus_slug: genre.canonical_slug || genre.slug, limit: 1, force: true,
            }, {
              successMessage: (r) => `Enrichment: ${r.updated ?? 0} updated`,
              errorMessage: "Description enrichment failed",
              pollTimeout: 45 * 60 * 1000,
            })}
          />
          <TaskButton
            label="Infer Taxonomy"
            busy={isBusy("infer")}
            onClick={() => run("infer", "/api/genres/infer", {
              focus_slug: genre.mapped ? null : genre.slug, limit: 160, aggressive: true, include_external: true,
            }, {
              successMessage: (r) => `Inference: ${r.mapped ?? 0} mapped, ${r.remaining_unmapped ?? 0} unmapped`,
              errorMessage: "Taxonomy inference failed",
            })}
          />
          <TaskButton
            label="Clean Invalid"
            busy={isBusy("cleanup-invalid")}
            onClick={() => run("cleanup-invalid", "/api/genres/taxonomy/cleanup-invalid", {}, {
              successMessage: (r) => `Cleanup: ${r.deleted_count ?? 0} invalid nodes removed`,
              errorMessage: "Genre taxonomy cleanup failed",
            })}
            icon={AlertTriangle}
          />
          {(genre.artists.length > 0 || genre.albums.length > 0) && (
            <TaskButton
              label="Generate Playlist"
              busy={creating}
              onClick={createSmartPlaylist}
              icon={ListMusic}
            />
          )}
        </div>
      </div>

      <div className="mb-8">
        <GenreNetworkGraph key={`${genre.slug}-${graphVersion}`} slug={genre.slug} />
      </div>

      {/* Equalizer preset editor — only for canonical taxonomy nodes.
          Raw library tags inherit via their canonical alias, so there's
          nothing to edit directly on them. */}
      {genre.mapped && genre.canonical_slug && (
        <div className="mb-8">
          <GenreEqEditor
            canonicalSlug={genre.canonical_slug}
            canonicalName={genre.canonical_name || genre.name}
            initialGains={genre.eq_gains ?? null}
            initialResolved={genre.eq_preset_resolved ?? null}
            onSaved={refetch}
          />
        </div>
      )}

      {/* Top Artists */}
      {genre.artists.length > 0 && (
        <div className="mb-8">
          <h2 className="font-semibold mb-4">Top Artists</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {genre.artists.map((a) => (
              <button
                key={a.artist_name}
                onClick={() => navigate(artistPagePath({ artistId: a.artist_id, artistSlug: a.artist_slug }))}
                className="bg-card border border-border rounded-lg p-3 text-left hover:border-primary transition-colors"
              >
                <div className="w-full aspect-square rounded-lg mb-2 overflow-hidden bg-secondary">
                  <img
                    src={artistPhotoApiUrl({ artistId: a.artist_id, artistSlug: a.artist_slug, artistName: a.artist_name })}
                    alt={a.artist_name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="font-semibold text-sm truncate">{a.artist_name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.album_count} albums
                  {a.listeners ? ` · ${formatNumber(a.listeners)} listeners` : ""}
                </div>
                {a.weight >= 0.8 && (
                  <Badge variant="outline" className="text-[10px] mt-1 px-1 py-0">primary</Badge>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Albums */}
      {genre.albums.length > 0 && (
        <div>
          <h2 className="font-semibold mb-4">Albums</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {genre.albums.map((a) => (
              <button
                key={a.album_id}
                onClick={() => navigate(albumPagePath({ albumId: a.album_id, albumSlug: a.album_slug }))}
                className="bg-card border border-border rounded-lg overflow-hidden text-left hover:border-primary transition-colors"
              >
                <div className="w-full aspect-square bg-secondary">
                  <img
                    src={albumCoverApiUrl({ albumId: a.album_id, albumSlug: a.album_slug, artistName: a.artist, albumName: a.name })}
                    alt={a.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
                <div className="p-2.5">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.artist}</div>
                  {a.year && <div className="text-[10px] text-muted-foreground">{a.year}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
