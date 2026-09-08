import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AIButton } from "@/components/ui/AIButton";
import { GenreNetworkGraph } from "@/components/genres/GenreNetworkGraph";
import { GenreEqEditor } from "@/components/genres/GenreEqEditor";
import { GenreTaxonomyTree } from "@/components/genres/GenreTaxonomyTree";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { ApiError, api } from "@/lib/api";
import { createSystemPlaylistFromBlueprint } from "@/lib/system-playlist-blueprints";
import { waitForTask } from "@/lib/tasks";
import { formatNumber } from "@/lib/utils";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import {
  Search,
  Sparkles,
  Tag,
  Disc3,
  Users,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  LayoutGrid,
  ListMusic,
  Network,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@crate/ui/primitives/ErrorState";

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
  cover_url?: string | null;
  eq_gains?: number[] | null;
  eq_reasoning?: string | null;
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

interface SoundIntelligenceHealth {
  eq: {
    total_tracks: number;
    sources: { source: string; count: number; percent: number }[];
  };
  taxonomy: {
    node_count: number;
    top_level_count: number;
    orphan_count: number;
    missing_description_count: number;
    missing_direct_eq_count: number;
    unmapped_raw_count: number;
    edge_count: number;
    locked_edge_count: number;
    manual_edge_count: number;
    ai_edge_count: number;
  };
}

interface TaxonomyNode {
  slug: string;
  name: string;
  description: string | null;
  cover_url?: string | null;
  top_level: boolean;
  parent_slugs: string[];
  children_slugs: string[];
  related_slugs: string[];
  influenced_by_slugs: string[];
  fusion_of_slugs: string[];
  alias_names: string[];
  artist_count: number;
  album_count: number;
}

interface TaxonomyTree {
  nodes: TaxonomyNode[];
  top_level_slugs: string[];
}

interface TaxonomyNodeProposal {
  source_kind?: "taxonomy_node" | "raw_genre";
  recommended_action?:
    | "create_node"
    | "alias_existing"
    | "delete_marginal"
    | "needs_review";
  recommended_target_slug?: string | null;
  description: string;
  aliases: string[];
  relations: {
    relation_type: string;
    target_slugs: string[];
    confidence: number;
    reasoning: string;
  }[];
  reasoning: string;
  evidence?: {
    artist_count?: number | null;
    album_count?: number | null;
    seed_artists?: string[];
    sample_albums?: string[];
    cooccurring_genres?: string[];
  };
}

interface TaxonomyNodeProposalApplyResponse {
  ok: boolean;
  slug: string;
  action: string;
  target_slug?: string | null;
  applied_aliases: string[];
  skipped_aliases: string[];
}

interface GenreDeleteResponse {
  ok: boolean;
  slug: string;
  name?: string | null;
  deleted_library_genres: number;
  deleted_taxonomy_nodes: number;
  removed_artist_assignments: number;
  removed_album_assignments: number;
  removed_raw_genres: string[];
}

const RELATION_EDITOR_CONFIG = [
  {
    key: "parent",
    label: "Parents",
    helper: "Subgenre relationship: this genre sits under these parent slugs.",
    field: "parent_slugs",
  },
  {
    key: "related",
    label: "Related / siblings",
    helper: "Adjacent genres that should help discovery and smart playlists.",
    field: "related_slugs",
  },
  {
    key: "influenced_by",
    label: "Influenced by",
    helper: "Lineage inputs that shaped this genre.",
    field: "influenced_by_slugs",
  },
  {
    key: "fusion_of",
    label: "Fusion of",
    helper: "Component genres blended into this genre.",
    field: "fusion_of_slugs",
  },
] as const;

function normalizeRelationSlug(value: string): string {
  return value.trim().toLowerCase();
}

function TaxonomyRelationField({
  config,
  value,
  options,
  sourceSlug,
  busy,
  stagedProposal,
  onChange,
  onSave,
}: {
  config: (typeof RELATION_EDITOR_CONFIG)[number];
  value: string[];
  options: TaxonomyNode[];
  sourceSlug: string;
  busy: boolean;
  stagedProposal:
    | {
        confidence: number;
        reasoning: string;
      }
    | undefined;
  onChange: (next: string[]) => void;
  onSave: () => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const selected = useMemo(() => new Set(value), [value]);
  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const candidates = options
      .filter((option) => {
        if (option.slug === sourceSlug || selected.has(option.slug)) {
          return false;
        }
        if (!normalizedQuery) return true;
        return (
          option.slug.includes(normalizedQuery) ||
          option.name.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((a, b) => {
        const aExact = a.slug.startsWith(normalizedQuery) ? 0 : 1;
        const bExact = b.slug.startsWith(normalizedQuery) ? 0 : 1;
        return aExact - bExact || a.name.localeCompare(b.name);
      });
    return candidates.slice(0, 8);
  }, [normalizedQuery, options, selected, sourceSlug]);

  const addSlug = (slug: string) => {
    const normalized = normalizeRelationSlug(slug);
    if (!normalized || normalized === sourceSlug || selected.has(normalized))
      return;
    onChange([...value, normalized]);
    setQuery("");
    setFocused(false);
  };

  const removeSlug = (slug: string) => {
    onChange(value.filter((item) => item !== slug));
  };

  return (
    <div className="rounded-lg border border-white/8 bg-black/20 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-white/75">
            {config.label}
          </div>
          <p className="mt-0.5 text-[11px] text-white/35">{config.helper}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          disabled={busy}
          onClick={onSave}
        >
          {busy ? (
            <Loader2 size={11} className="mr-1 animate-spin" />
          ) : (
            <Save size={11} className="mr-1" />
          )}
          Save
        </Button>
      </div>

      <div className="rounded-md border border-white/10 bg-black/30 p-2 transition focus-within:border-cyan-400/40">
        {value.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {value.map((slug) => {
              const option = options.find((item) => item.slug === slug);
              return (
                <Badge
                  key={`${config.key}-${slug}`}
                  variant="outline"
                  className="gap-1 border-cyan-400/20 bg-cyan-400/10 pr-1 text-[10px] text-cyan-100"
                >
                  <span>{option?.name ?? slug}</span>
                  <span className="font-mono text-cyan-100/45">{slug}</span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-cyan-100/55 transition hover:bg-white/10 hover:text-white"
                    aria-label={`Remove ${slug}`}
                    onClick={() => removeSlug(slug)}
                  >
                    <X size={10} />
                  </button>
                </Badge>
              );
            })}
          </div>
        ) : null}
        <div className="relative">
          <label htmlFor="genre-filter" className="sr-only">
            Filter genres
          </label>
          <input
            id="genre-filter"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (suggestions[0]) addSlug(suggestions[0].slug);
              }
              if (event.key === "Escape") setFocused(false);
            }}
            className="w-full bg-transparent px-1 py-1 font-mono text-xs text-white/70 outline-none placeholder:text-white/25"
            placeholder="Search taxonomy genres..."
          />
          {focused && suggestions.length > 0 ? (
            <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-white/10 bg-[#111118] shadow-2xl">
              {suggestions.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-white/70 transition hover:bg-cyan-400/10 hover:text-cyan-100"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addSlug(option.slug)}
                >
                  <span className="font-semibold">{option.name}</span>
                  <span className="font-mono text-[10px] text-white/35">
                    {option.slug}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {stagedProposal ? (
        <div className="mt-2 rounded-md border border-cyan-400/15 bg-cyan-400/[0.04] px-2.5 py-2 text-[11px] text-white/45">
          <span className="font-semibold text-cyan-200">
            AI {Math.round(stagedProposal.confidence * 100)}%
          </span>
          {stagedProposal.reasoning
            ? ` · ${stagedProposal.reasoning}`
            : " · staged from inference"}
        </div>
      ) : null}
    </div>
  );
}

function proposalActionLabel(
  action: TaxonomyNodeProposal["recommended_action"],
) {
  if (action === "create_node") return "Create canonical node";
  if (action === "alias_existing") return "Map as alias";
  if (action === "delete_marginal") return "Remove marginal tag";
  return "Needs curator review";
}

function proposalApplyLabel(
  action: TaxonomyNodeProposal["recommended_action"],
) {
  if (action === "create_node") return "Create taxonomy node";
  if (action === "delete_marginal") return "Consolidate marginal tag";
  if (action === "alias_existing") return "Consolidate as alias";
  return "Needs review";
}

const EQ_SOURCE_LABELS: Record<string, string> = {
  user_track_preset: "User track",
  instance_track_preset: "Curator track",
  instance_album_preset: "Curator album",
  genre_taxonomy_preset: "Genre taxonomy",
  audio_analysis_preset: "Audio analysis",
  flat: "Flat",
};

function genreDeleteSummary(result: GenreDeleteResponse) {
  const assignmentCount =
    result.removed_artist_assignments + result.removed_album_assignments;
  if (assignmentCount === 0) return "Deleted genre metadata";
  return `Removed ${assignmentCount} genre assignment${
    assignmentCount === 1 ? "" : "s"
  }`;
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
  ai = false,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
  icon?: typeof Sparkles;
  variant?: "outline" | "default";
  ai?: boolean;
}) {
  if (ai) {
    return (
      <AIButton onClick={onClick} loading={busy}>
        {label}
      </AIButton>
    );
  }

  return (
    <Button variant={variant} size="sm" onClick={onClick} disabled={busy}>
      {busy ? (
        <Loader2 size={14} className="animate-spin mr-1" />
      ) : (
        <Icon size={14} className="mr-1" />
      )}
      {label}
    </Button>
  );
}

function TaxonomyNodeEditorialEditor({
  canonicalSlug,
  coverUrl,
  rawSlug,
  rawName,
  canCurate,
  onSaved,
  onDeleted,
}: {
  canonicalSlug: string | null | undefined;
  coverUrl?: string | null;
  rawSlug: string;
  rawName: string;
  canCurate: boolean;
  onSaved: () => void;
  onDeleted?: () => void;
}) {
  const proposalSlug = canonicalSlug || rawSlug;
  const { data, loading, refetch } = useApi<TaxonomyTree>(
    canCurate && canonicalSlug ? "/api/genres/taxonomy/tree" : null,
  );
  const node = useMemo(
    () =>
      canonicalSlug
        ? data?.nodes.find((item) => item.slug === canonicalSlug) ?? null
        : null,
    [canonicalSlug, data?.nodes],
  );
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [topLevelDraft, setTopLevelDraft] = useState(false);
  const [relationDrafts, setRelationDrafts] = useState<
    Record<string, string[]>
  >({});
  const [proposal, setProposal] = useState<TaxonomyNodeProposal | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [coverVersion, setCoverVersion] = useState(0);
  const [deleteNodeOpen, setDeleteNodeOpen] = useState(false);

  useEffect(() => {
    if (!node) return;
    setDescriptionDraft(node.description ?? "");
    setTopLevelDraft(node.top_level);
    setRelationDrafts({
      parent: node.parent_slugs ?? [],
      related: node.related_slugs ?? [],
      influenced_by: node.influenced_by_slugs ?? [],
      fusion_of: node.fusion_of_slugs ?? [],
    });
    setProposal(null);
  }, [node]);

  if (!canCurate) return null;

  const refresh = () => {
    refetch();
    onSaved();
  };

  const refreshCover = () => {
    setCoverVersion(Date.now());
    refresh();
  };

  const visibleCoverUrl =
    coverUrl && coverVersion > 0
      ? `${coverUrl}${coverUrl.includes("?") ? "&" : "?"}v=${coverVersion}`
      : coverUrl;

  const inferNodeProposal = async () => {
    if (!proposalSlug) return;
    setSavingKey("proposal");
    try {
      const result = await api<TaxonomyNodeProposal>(
        `/api/genres/taxonomy/${proposalSlug}/proposal`,
        "POST",
      );
      setProposal(result);
      if (node && result.description) setDescriptionDraft(result.description);
      if (node && result.relations.length > 0) {
        setRelationDrafts((prev) => {
          const next = { ...prev };
          for (const relation of result.relations) {
            next[relation.relation_type] = relation.target_slugs;
          }
          return next;
        });
      }
      toast.success("AI proposal staged for review");
    } catch {
      toast.error("Failed to infer taxonomy node");
    } finally {
      setSavingKey(null);
    }
  };

  const saveMetadata = async () => {
    if (!node) return;
    setSavingKey("metadata");
    try {
      await api(`/api/genres/taxonomy/${node.slug}`, "PATCH", {
        description: descriptionDraft,
        top_level: topLevelDraft,
      });
      toast.success("Genre metadata saved");
      refresh();
    } catch {
      toast.error("Failed to save genre metadata");
    } finally {
      setSavingKey(null);
    }
  };

  const saveRelation = async (relationType: string) => {
    if (!node) return;
    setSavingKey(`relation:${relationType}`);
    try {
      const result = await api<{ missing?: string[] }>(
        `/api/genres/taxonomy/${node.slug}/relations`,
        "PUT",
        {
          relation_type: relationType,
          target_slugs: relationDrafts[relationType] ?? [],
        },
      );
      if (result.missing?.length) {
        toast.warning(`Saved, but missing: ${result.missing.join(", ")}`);
      } else {
        toast.success("Taxonomy relation saved");
      }
      refresh();
    } catch {
      toast.error("Failed to save taxonomy relation");
    } finally {
      setSavingKey(null);
    }
  };

  const applyProposalAliases = async () => {
    if (!node || !proposal?.aliases.length) return;
    setSavingKey("aliases");
    try {
      const result = await api<{ applied?: string[] }>(
        `/api/genres/taxonomy/${node.slug}/aliases`,
        "PUT",
        { alias_names: proposal.aliases },
      );
      const appliedCount = result.applied?.length ?? 0;
      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} aliases`);
      } else {
        toast.warning("No aliases applied");
      }
      refresh();
    } catch {
      toast.error("Failed to apply aliases");
    } finally {
      setSavingKey(null);
    }
  };

  const applyRawProposal = async () => {
    if (!proposal) return;
    setSavingKey("apply");
    try {
      const payload = {
        source_kind: proposal.source_kind ?? "raw_genre",
        recommended_action: proposal.recommended_action ?? "needs_review",
        recommended_target_slug: proposal.recommended_target_slug ?? null,
        name: rawName,
        description: proposal.description ?? "",
        aliases: (proposal.aliases ?? []).filter(Boolean),
        relations: (proposal.relations ?? []).map((relation) => ({
          relation_type: relation.relation_type,
          target_slugs: relation.target_slugs ?? [],
          confidence: relation.confidence ?? 0.5,
          reasoning: relation.reasoning ?? "",
        })),
        reasoning: proposal.reasoning ?? "",
      };
      const result = await api<TaxonomyNodeProposalApplyResponse>(
        `/api/genres/taxonomy/${encodeURIComponent(rawSlug)}/proposal/apply`,
        "POST",
        payload,
      );
      if (result.action === "create_node") {
        toast.success("Taxonomy node created");
      } else {
        toast.success(
          `Mapped ${result.applied_aliases.length} alias${
            result.applied_aliases.length === 1 ? "" : "es"
          } to ${result.target_slug}`,
        );
      }
      setProposal(null);
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `Failed to apply taxonomy proposal: ${error.message}`
          : "Failed to apply taxonomy proposal",
      );
    } finally {
      setSavingKey(null);
    }
  };

  const deleteCanonicalNode = async () => {
    if (!node) return;
    setSavingKey("delete-node");
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/taxonomy/${encodeURIComponent(node.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteNodeOpen(false);
      onDeleted?.();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `Failed to delete genre: ${error.message}`
          : "Failed to delete genre",
      );
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <>
      <OpsPanel
        icon={Network}
        title={
          canonicalSlug ? "Editorial Taxonomy Node" : "Unmapped Genre Proposal"
        }
        description={
          canonicalSlug
            ? "Curator-level editing for the canonical node behind this genre page."
            : "Ask AI to decide whether this raw tag deserves a node, should become an alias, or should be removed as marginal."
        }
      >
        {!canonicalSlug ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {rawName}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{rawSlug}</span>
                  <span>raw library tag</span>
                </div>
              </div>
              <AIButton
                onClick={inferNodeProposal}
                loading={savingKey === "proposal"}
                disabled={savingKey !== null && savingKey !== "proposal"}
              >
                Infer node with AI
              </AIButton>
            </div>

            {proposal ? (
              <div className="space-y-3 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-4 text-xs text-white/55">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                      {proposalActionLabel(proposal.recommended_action)}
                    </Badge>
                    {proposal.recommended_target_slug ? (
                      <Badge variant="outline">
                        target: {proposal.recommended_target_slug}
                      </Badge>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    className="bg-cyan-400 text-black hover:bg-cyan-300"
                    disabled={
                      savingKey === "apply" ||
                      proposal.recommended_action === "needs_review" ||
                      (proposal.recommended_action !== "create_node" &&
                        !proposal.recommended_target_slug)
                    }
                    onClick={applyRawProposal}
                  >
                    {savingKey === "apply" ? (
                      <Loader2 size={13} className="mr-1.5 animate-spin" />
                    ) : (
                      <Save size={13} className="mr-1.5" />
                    )}
                    {proposalApplyLabel(proposal.recommended_action)}
                  </Button>
                </div>
                {proposal.description ? (
                  <p className="text-sm leading-6 text-white/70">
                    {proposal.description}
                  </p>
                ) : null}
                {proposal.reasoning ? (
                  <p className="text-white/45">{proposal.reasoning}</p>
                ) : null}
                {proposal.evidence ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-white/8 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                        Artists
                      </div>
                      <div className="mt-1 text-white/65">
                        {(proposal.evidence.seed_artists ?? [])
                          .slice(0, 6)
                          .join(", ") || "No local artists"}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                        Albums
                      </div>
                      <div className="mt-1 text-white/65">
                        {(proposal.evidence.sample_albums ?? [])
                          .slice(0, 4)
                          .join(", ") || "No local albums"}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-white/35">
                        Co-occurs with
                      </div>
                      <div className="mt-1 text-white/65">
                        {(proposal.evidence.cooccurring_genres ?? [])
                          .slice(0, 6)
                          .join(", ") || "No mapped context"}
                      </div>
                    </div>
                  </div>
                ) : null}
                {proposal.aliases.length > 0 ||
                proposal.relations.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {proposal.aliases.slice(0, 8).map((alias) => (
                      <Badge key={`alias-${alias}`} variant="outline">
                        alias: {alias}
                      </Badge>
                    ))}
                    {proposal.relations.map((relation) => (
                      <Badge
                        key={`${
                          relation.relation_type
                        }-${relation.target_slugs.join("-")}`}
                        variant="outline"
                      >
                        {relation.relation_type}:{" "}
                        {relation.target_slugs.join(", ")}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                This genre is unmapped. Run inference to get a reviewable
                proposal with local artists, albums, and alias/delete guidance.
              </div>
            )}
          </div>
        ) : loading && !node ? (
          <div className="py-8 text-sm text-muted-foreground">
            Loading taxonomy node...
          </div>
        ) : !node ? (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            Canonical node not found in the taxonomy tree.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {node.name}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{node.slug}</span>
                  <span>{node.artist_count} artists</span>
                  <span>{node.album_count} albums</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <AIButton
                  onClick={inferNodeProposal}
                  loading={savingKey === "proposal"}
                  disabled={savingKey !== null && savingKey !== "proposal"}
                >
                  Infer node with AI
                </AIButton>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  disabled={savingKey === "metadata"}
                  onClick={saveMetadata}
                >
                  {savingKey === "metadata" ? (
                    <Loader2 size={13} className="mr-1 animate-spin" />
                  ) : (
                    <Save size={13} className="mr-1" />
                  )}
                  Save node
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="text-xs"
                  disabled={savingKey === "delete-node"}
                  onClick={() => setDeleteNodeOpen(true)}
                >
                  {savingKey === "delete-node" ? (
                    <Loader2 size={13} className="mr-1 animate-spin" />
                  ) : (
                    <Trash2 size={13} className="mr-1" />
                  )}
                  Delete
                </Button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
              <div className="space-y-2">
                <div className="group/genre-cover relative aspect-[2/1] overflow-hidden rounded-md border border-white/10 bg-black/30 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                  {visibleCoverUrl ? (
                    <img
                      src={visibleCoverUrl}
                      alt={`${node.name} genre cover`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.18),transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.015))] text-center">
                      <Tag size={20} className="text-cyan-300/70" />
                      <span className="text-[11px] font-medium text-white/45">
                        No genre cover
                      </span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_35%,rgba(0,0,0,0.42))]" />
                  {node ? (
                    <ImageCropUpload
                      endpoint={`/api/genres/taxonomy/${node.slug}/cover`}
                      aspect={2}
                      onUploaded={refreshCover}
                      label="Edit cover"
                      className="absolute inset-0 z-10 flex items-end justify-center gap-1.5 bg-black/0 p-3 text-xs font-semibold text-white/0 outline-none transition hover:bg-black/35 hover:text-white/85 focus-visible:bg-black/35 focus-visible:text-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-300/40"
                    />
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-white/35">
                    Description
                  </span>
                  <textarea
                    value={descriptionDraft}
                    onChange={(event) =>
                      setDescriptionDraft(event.target.value)
                    }
                    rows={5}
                    className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/75 outline-none transition focus:border-cyan-400/40"
                    placeholder="Short editorial description for this genre."
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-xs text-white/60">
                  <input
                    type="checkbox"
                    checked={topLevelDraft}
                    onChange={(event) => setTopLevelDraft(event.target.checked)}
                    className="h-3.5 w-3.5 accent-cyan-400"
                  />
                  Top-level genre
                </label>
              </div>
            </div>

            {proposal ? (
              <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-3 text-xs text-white/55">
                <div className="font-semibold uppercase tracking-[0.16em] text-cyan-200">
                  AI proposal staged
                </div>
                {proposal.reasoning ? (
                  <p className="mt-2 text-white/45">{proposal.reasoning}</p>
                ) : null}
                {proposal.aliases.length > 0 ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {proposal.aliases.map((alias) => (
                      <Badge
                        key={alias}
                        variant="outline"
                        className="text-[10px]"
                      >
                        alias: {alias}
                      </Badge>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={savingKey === "aliases"}
                      onClick={applyProposalAliases}
                    >
                      {savingKey === "aliases" ? (
                        <Loader2 size={11} className="mr-1 animate-spin" />
                      ) : (
                        <Tag size={11} className="mr-1" />
                      )}
                      Apply aliases
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-2">
              {RELATION_EDITOR_CONFIG.map((config) => {
                const value = relationDrafts[config.key] ?? [];
                const busy = savingKey === `relation:${config.key}`;
                const stagedProposal = proposal?.relations.find(
                  (relation) => relation.relation_type === config.key,
                );
                return (
                  <TaxonomyRelationField
                    key={config.key}
                    config={config}
                    value={value}
                    options={data?.nodes ?? []}
                    sourceSlug={node.slug}
                    busy={busy}
                    stagedProposal={stagedProposal}
                    onChange={(next) =>
                      setRelationDrafts((prev) => ({
                        ...prev,
                        [config.key]: next,
                      }))
                    }
                    onSave={() => saveRelation(config.key)}
                  />
                );
              })}
            </div>
          </div>
        )}
      </OpsPanel>
      <ConfirmDialog
        open={deleteNodeOpen}
        onOpenChange={setDeleteNodeOpen}
        title={`Delete ${node?.name ?? "genre"}?`}
        description={`This removes the taxonomy node, aliases, relations, and all mapped raw genre assignments from artists and albums. This cannot be undone.`}
        confirmLabel="Delete Genre"
        variant="destructive"
        onConfirm={deleteCanonicalNode}
      />
    </>
  );
}

// ── Genre List ──────────────────────────────────────────────────

export function Genres() {
  const { slug } = useParams<{ slug?: string }>();

  if (slug) return <GenreView slug={slug} />;
  return <GenreList />;
}

function GenreList() {
  const { hasCapability } = useAuth();
  const canCurateGenres = hasCapability("curation.genres.write");
  const canCuratePlaylists = hasCapability("curation.playlists.write");
  const {
    data: genres,
    loading,
    error,
    refetch,
  } = useApi<Genre[]>("/api/genres");
  const { data: unmappedGenres, refetch: refetchUnmapped } = useApi<Genre[]>(
    "/api/genres/unmapped?limit=100",
  );
  const { data: invalidTaxonomy, refetch: refetchInvalidTaxonomy } =
    useApi<InvalidTaxonomyStatus>(
      canCurateGenres ? "/api/genres/taxonomy/invalid?limit=8" : null,
    );
  const { data: soundHealth, refetch: refetchSoundHealth } =
    useApi<SoundIntelligenceHealth>(
      canCurateGenres ? "/api/genres/sound-intelligence/health" : null,
    );
  const { pollTask } = useTaskPoll();
  const [filter, setFilter] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "tree">("grid");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Genre | null>(null);
  const navigate = useNavigate();

  const afterSuccess = useCallback(() => {
    refetch();
    refetchUnmapped();
    if (canCurateGenres) refetchInvalidTaxonomy();
    if (canCurateGenres) refetchSoundHealth();
  }, [
    canCurateGenres,
    refetch,
    refetchUnmapped,
    refetchInvalidTaxonomy,
    refetchSoundHealth,
  ]);
  const { run, isBusy } = useGenreTask(pollTask, afterSuccess);

  const filtered = useMemo(() => {
    if (!genres) return [];
    return genres
      .filter(
        (g) =>
          g.name.toLowerCase().includes(filter.toLowerCase()) &&
          (!hideEmpty || g.artist_count > 0 || g.album_count > 0),
      )
      .sort((a, b) => b.artist_count - a.artist_count);
  }, [genres, filter, hideEmpty]);

  const mappedCount = useMemo(
    () => (genres ?? []).filter((genre) => genre.mapped).length,
    [genres],
  );

  async function reindex() {
    setIndexing(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/genres/index",
        "POST",
      );
      const task = await waitForTask(task_id, 30 * 60 * 1000);
      if (task.status === "completed") {
        afterSuccess();
        toast.success("Genres re-indexed");
      } else {
        toast.error(task.error || "Genre indexing failed");
      }
    } catch {
      toast.error("Failed to start indexing");
    } finally {
      setIndexing(false);
    }
  }

  async function deleteRawGenre() {
    if (!deleteTarget) return;
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/${encodeURIComponent(deleteTarget.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteTarget(null);
      afterSuccess();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `Failed to delete genre: ${error.message}`
          : "Failed to delete genre",
      );
    }
  }

  if (error)
    return <ErrorState message="Failed to load genres" onRetry={refetch} />;
  if (loading) {
    return (
      <div className="space-y-6">
        <OpsPageHero
          icon={Tag}
          title="Genres"
          description="Taxonomy curation, raw tag cleanup and discovery of the genre graph that organizes the library."
        >
          <CrateChip icon={Tag}>Loading taxonomy</CrateChip>
        </OpsPageHero>
        <GridSkeleton count={12} columns="grid-cols-4" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Tag}
        title="Genres"
        description="Taxonomy curation, raw tag cleanup and discovery of the graph that organizes the musical vocabulary of the library."
        actions={
          canCurateGenres ? (
            <div className="flex flex-wrap items-center gap-2">
              <TaskButton
                label="Sync MusicBrainz"
                busy={isBusy("mb-sync")}
                onClick={() =>
                  run(
                    "mb-sync",
                    "/api/genres/musicbrainz/sync",
                    { limit: 80 },
                    {
                      successMessage: (r) =>
                        `MusicBrainz sync: ${r.edges_synced ?? 0} edges, ${
                          r.matched_musicbrainz ?? 0
                        } matched`,
                      errorMessage: "MusicBrainz sync failed",
                      pollTimeout: 60 * 60 * 1000,
                    },
                  )
                }
              />
              <TaskButton
                label="Enrich descriptions"
                busy={isBusy("enrich")}
                onClick={() =>
                  run(
                    "enrich",
                    "/api/genres/descriptions/enrich",
                    { limit: 160 },
                    {
                      successMessage: (r) =>
                        `Enrichment: ${r.updated ?? 0} updated, ${
                          r.remaining_without_external ?? 0
                        } missing`,
                      errorMessage: "Description enrichment failed",
                      pollTimeout: 45 * 60 * 1000,
                    },
                  )
                }
              />
              <TaskButton
                label="Infer taxonomy"
                busy={isBusy("infer")}
                onClick={() =>
                  run(
                    "infer",
                    "/api/genres/infer",
                    { limit: 250, aggressive: true, include_external: true },
                    {
                      successMessage: (r) =>
                        `Inference: ${r.mapped ?? 0} mapped, ${
                          r.remaining_unmapped ?? 0
                        } unmapped`,
                      errorMessage: "Taxonomy inference failed",
                    },
                  )
                }
              />
              <TaskButton
                label="Build proposal with AI"
                busy={isBusy("rebuild-proposal")}
                ai
                onClick={() =>
                  run(
                    "rebuild-proposal",
                    "/api/genres/taxonomy/rebuild-proposal",
                    {
                      alias_limit: 120,
                      node_limit: 16,
                      aggressive: true,
                      include_external: true,
                    },
                    {
                      successMessage: (r) => {
                        const summary =
                          (r.summary as Record<string, unknown> | undefined) ||
                          {};
                        return `Proposal: ${
                          summary.alias_proposals ?? 0
                        } aliases, ${summary.node_proposals ?? 0} nodes`;
                      },
                      errorMessage: "Taxonomy rebuild proposal failed",
                      pollTimeout: 60 * 60 * 1000,
                    },
                  )
                }
                icon={Network}
              />
              <TaskButton
                label="Clean invalid nodes"
                busy={isBusy("cleanup-invalid")}
                onClick={() =>
                  run(
                    "cleanup-invalid",
                    "/api/genres/taxonomy/cleanup-invalid",
                    {},
                    {
                      successMessage: (r) =>
                        `Cleanup: ${
                          r.deleted_count ?? 0
                        } invalid nodes removed`,
                      errorMessage: "Genre taxonomy cleanup failed",
                    },
                  )
                }
                icon={AlertTriangle}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={reindex}
                disabled={indexing}
              >
                {indexing ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="mr-2" />
                )}
                Re-index
              </Button>
            </div>
          ) : undefined
        }
      >
        <CrateChip icon={Tag}>{genres?.length ?? 0} total genres</CrateChip>
        <CrateChip icon={Users}>{mappedCount} mapped</CrateChip>
        <CrateChip
          className={
            (unmappedGenres?.length || 0) > 0
              ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
              : undefined
          }
        >
          {unmappedGenres?.length || 0} unmapped
        </CrateChip>
        {canCurateGenres && invalidTaxonomy ? (
          <CrateChip
            className={
              invalidTaxonomy.invalid_count > 0
                ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
            }
          >
            {invalidTaxonomy.invalid_count > 0
              ? `${invalidTaxonomy.invalid_count} invalid nodes`
              : "taxonomy clean"}
          </CrateChip>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          icon={Tag}
          label="Genres"
          value={formatNumber(genres?.length ?? 0)}
          caption="Total nodes available in taxonomy and raw tag space"
          tone="primary"
        />
        <OpsStatTile
          icon={Users}
          label="Mapped"
          value={formatNumber(mappedCount)}
          caption="Genres already attached to the curated graph"
          tone="default"
        />
        <OpsStatTile
          icon={AlertTriangle}
          label="Unmapped"
          value={formatNumber(unmappedGenres?.length ?? 0)}
          caption="Detected tags still outside the curated taxonomy"
          tone={(unmappedGenres?.length ?? 0) > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          icon={Network}
          label="Filtered"
          value={formatNumber(filtered.length)}
          caption={
            filter
              ? `Current filter: ${filter}`
              : "Visible genres in current view"
          }
          tone="default"
        />
      </div>

      {canCurateGenres && soundHealth ? (
        <OpsPanel
          icon={Sparkles}
          title="Sound Intelligence"
          description="Effective EQ coverage and taxonomy health, so Smart EQ and discovery do not silently fall back to weak data."
        >
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Effective EQ sources
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(soundHealth.eq.total_tracks)} tracks resolved
                    through the Smart EQ hierarchy.
                  </p>
                </div>
              </div>
              <div className="space-y-2.5">
                {soundHealth.eq.sources.map((source) => (
                  <div key={source.source} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/65">
                        {EQ_SOURCE_LABELS[source.source] ?? source.source}
                      </span>
                      <span className="font-mono text-white/45">
                        {formatNumber(source.count)} · {source.percent}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <div
                        className={`h-full rounded-full ${
                          source.source === "flat"
                            ? "bg-amber-400/70"
                            : "bg-cyan-400/80"
                        }`}
                        style={{ width: `${Math.min(source.percent, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <OpsStatTile
                icon={Network}
                label="Taxonomy nodes"
                value={formatNumber(soundHealth.taxonomy.node_count)}
                caption={`${formatNumber(
                  soundHealth.taxonomy.edge_count,
                )} graph edges · ${formatNumber(
                  soundHealth.taxonomy.locked_edge_count,
                )} locked`}
                tone="default"
              />
              <OpsStatTile
                icon={AlertTriangle}
                label="Needs mapping"
                value={formatNumber(soundHealth.taxonomy.unmapped_raw_count)}
                caption="Raw genre tags not linked to curated taxonomy"
                tone={
                  soundHealth.taxonomy.unmapped_raw_count > 0
                    ? "warning"
                    : "default"
                }
              />
              <OpsStatTile
                icon={Tag}
                label="Orphans"
                value={formatNumber(soundHealth.taxonomy.orphan_count)}
                caption="Non top-level nodes without a parent relation"
                tone={
                  soundHealth.taxonomy.orphan_count > 0 ? "warning" : "default"
                }
              />
              <OpsStatTile
                icon={Sparkles}
                label="Missing copy"
                value={formatNumber(
                  soundHealth.taxonomy.missing_description_count,
                )}
                caption={`${formatNumber(
                  soundHealth.taxonomy.missing_direct_eq_count,
                )} nodes without direct EQ`}
                tone={
                  soundHealth.taxonomy.missing_description_count > 0
                    ? "warning"
                    : "default"
                }
              />
            </div>
          </div>
        </OpsPanel>
      ) : null}

      <OpsPanel
        icon={Search}
        title="Explore Taxonomy"
        description="Search, switch between taxonomy views and work through unmapped or invalid nodes."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-xl">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter genres..."
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-3">
              {viewMode === "tree" && (
                <button
                  type="button"
                  onClick={() => setHideEmpty(!hideEmpty)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                    hideEmpty
                      ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white"
                  }`}
                >
                  Non-empty only
                </button>
              )}
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 p-1 shadow-[0_12px_28px_rgba(0,0,0,0.16)]">
                <ActionIconButton
                  variant="card"
                  active={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  title="Grid view"
                >
                  <LayoutGrid size={14} />
                </ActionIconButton>
                <ActionIconButton
                  variant="card"
                  active={viewMode === "tree"}
                  onClick={() => setViewMode("tree")}
                  title="Tree view"
                >
                  <Network size={14} />
                </ActionIconButton>
              </div>
            </div>
          </div>

          {canCurateGenres && !!invalidTaxonomy?.invalid_count && (
            <div className="rounded-md border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.16),rgba(120,53,15,0.08))] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-300" />
                <div className="font-semibold text-foreground">
                  Taxonomy cleanup recommended
                </div>
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-100"
                >
                  {invalidTaxonomy.invalid_count} invalid nodes
                </Badge>
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-black/10 text-amber-50"
                >
                  {invalidTaxonomy.alias_count} aliases
                </Badge>
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-black/10 text-amber-50"
                >
                  {invalidTaxonomy.edge_count} edges
                </Badge>
              </div>
              <p className="mb-3 text-sm text-muted-foreground">
                MusicBrainz syncs previously stored malformed taxonomy nodes.
                You can remove them safely with the cleanup task.
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                {invalidTaxonomy.items.map((item) => (
                  <div
                    key={`invalid-taxonomy-${item.slug}`}
                    className="rounded-md border border-amber-500/20 bg-black/10 px-3 py-2"
                  >
                    <div className="truncate text-sm font-medium text-foreground">
                      {item.name || item.slug}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {item.reason?.replace(/-/g, " ") || "invalid node"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === "tree" ? (
            <GenreTaxonomyTree
              filter={filter}
              hideEmpty={hideEmpty}
              canCurate={canCurateGenres}
              canCreatePlaylists={canCuratePlaylists}
              onChanged={afterSuccess}
            />
          ) : (
            <>
              {(unmappedGenres?.length || 0) > 0 && (
                <div className="rounded-md border border-amber-500/20 bg-[linear-gradient(135deg,rgba(245,158,11,0.15),rgba(120,53,15,0.08))] p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
                  <div className="mb-3 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-300" />
                    <div className="font-semibold text-foreground">
                      Needs taxonomy mapping
                    </div>
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-amber-500/10 text-amber-100"
                    >
                      {unmappedGenres!.length}
                    </Badge>
                  </div>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Genres from tags or MusicBrainz that still sit outside the
                    curated graph. Run inference to map them.
                  </p>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {unmappedGenres!.slice(0, 12).map((genre) => (
                      <div
                        key={`unmapped-${genre.slug}`}
                        className="flex items-center justify-between rounded-md border border-amber-500/20 bg-black/10 px-3 py-2 text-left transition-colors hover:bg-black/20"
                      >
                        <button
                          type="button"
                          onClick={() => navigate(`/genres/${genre.slug}`)}
                          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                        >
                          <div className="truncate text-sm font-medium text-foreground">
                            {genre.name}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {genre.artist_count} artists · {genre.album_count}{" "}
                            albums
                          </div>
                        </button>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 text-amber-100"
                          >
                            unmapped
                          </Badge>
                          {canCurateGenres ? (
                            <button
                              type="button"
                              className="rounded-md p-1 text-white/30 transition hover:bg-red-500/10 hover:text-red-200"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTarget(genre);
                              }}
                              aria-label={`Delete ${genre.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  {genres?.length === 0 ? (
                    <div className="space-y-3">
                      <p>No genres indexed yet.</p>
                      {canCurateGenres ? (
                        <Button onClick={reindex} disabled={indexing}>
                          Index Genres
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    "No genres match your filter."
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {filtered.map((g) => (
                    <div
                      key={g.id}
                      className={`group overflow-hidden rounded-md border bg-black/20 p-4 text-left shadow-[0_16px_36px_rgba(0,0,0,0.16)] transition-colors hover:bg-white/[0.04] ${
                        g.mapped
                          ? "border-white/8 hover:border-primary/30"
                          : "border-amber-500/30"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/genres/${g.slug}`)}
                          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                        >
                          <div className="font-semibold text-foreground text-sm truncate">
                            {g.name}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={
                              g.mapped
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-100"
                            }
                          >
                            {g.mapped ? "mapped" : "unmapped"}
                          </Badge>
                          {canCurateGenres ? (
                            <button
                              type="button"
                              className="rounded-md p-1 text-white/25 opacity-0 transition hover:bg-red-500/10 hover:text-red-200 group-hover:opacity-100 focus:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteTarget(g);
                              }}
                              aria-label={`Delete ${g.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          ) : null}
                        </div>
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
                        <span className="flex items-center gap-1">
                          <Users size={11} />
                          {g.artist_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <Disc3 size={11} />
                          {g.album_count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </OpsPanel>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "genre"}?`}
        description="This removes this raw genre from every artist and album that currently uses it. This cannot be undone."
        confirmLabel="Delete Genre"
        variant="destructive"
        onConfirm={deleteRawGenre}
      />
    </div>
  );
}

// ── Genre Detail View ───────────────────────────────────────────

function GenreView({ slug }: { slug: string }) {
  const { hasCapability } = useAuth();
  const canCurateGenres = hasCapability("curation.genres.write");
  const canCuratePlaylists = hasCapability("curation.playlists.write");
  const {
    data: genre,
    loading,
    refetch,
  } = useApi<GenreDetail>(`/api/genres/${slug}`);
  const { pollTask } = useTaskPoll();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const [deleteGenreOpen, setDeleteGenreOpen] = useState(false);

  const afterSuccess = useCallback(() => {
    refetch();
    setGraphVersion((v) => v + 1);
  }, [refetch]);
  const { run, isBusy } = useGenreTask(pollTask, afterSuccess);

  async function createSmartPlaylist() {
    if (!genre) return;
    setCreating(true);
    try {
      const playlist = await createSystemPlaylistFromBlueprint({
        targetType: "genre",
        targetName: genre.slug || genre.name,
        blueprintKey: "genre-primer",
      });
      toast.success(`Created "${playlist.name}"`);
      navigate(`/playlists/${playlist.id}`);
    } catch {
      toast.error("Failed to create editorial playlist");
    } finally {
      setCreating(false);
    }
  }

  async function deleteCurrentGenre() {
    if (!genre) return;
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/${encodeURIComponent(genre.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteGenreOpen(false);
      navigate("/genres");
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `Failed to delete genre: ${error.message}`
          : "Failed to delete genre",
      );
    }
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
      <div className="text-center py-12 text-muted-foreground">
        Genre not found
      </div>
    );
  }

  const description =
    genre.description ||
    genre.canonical_description ||
    (genre.mapped
      ? "Curated genre node inside your taxonomy graph."
      : "Raw library tag detected in your collection but not yet linked into the curated taxonomy.");
  const hasCanonicalTaxonomyNode = Boolean(genre.canonical_slug);
  const aliasNote =
    genre.canonical_name && genre.canonical_name !== genre.name
      ? `${genre.name} is currently treated as an alias of ${genre.canonical_name}.`
      : null;
  const taxonomyActionNote = !hasCanonicalTaxonomyNode
    ? "Map this raw tag into the taxonomy first to enable MusicBrainz sync and external description enrichment."
    : aliasNote
      ? `MusicBrainz sync and description enrichment currently operate on ${genre.canonical_name}.`
      : null;
  const externalDescription = genre.external_description?.trim();
  const externalSource = genre.external_description_source?.trim();

  return (
    <div className="space-y-6">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/genres")}>
          <ArrowLeft size={14} className="mr-1" /> Genres
        </Button>
      </div>

      <OpsPageHero
        icon={Tag}
        title={genre.name}
        description={description}
        actions={
          canCurateGenres || canCuratePlaylists ? (
            <div className="flex flex-wrap gap-2">
              {canCurateGenres && hasCanonicalTaxonomyNode ? (
                <>
                  <TaskButton
                    label="Sync MusicBrainz"
                    busy={isBusy("mb-sync")}
                    onClick={() =>
                      run(
                        "mb-sync",
                        "/api/genres/musicbrainz/sync",
                        {
                          focus_slug: genre.canonical_slug || genre.slug,
                          limit: 1,
                          force: true,
                        },
                        {
                          successMessage: (r) =>
                            r.reason === "focus_slug_not_taxonomy_node"
                              ? "Map this raw tag into the taxonomy before syncing MusicBrainz"
                              : `MusicBrainz sync: ${
                                  r.edges_synced ?? 0
                                } edges`,
                          errorMessage: "MusicBrainz sync failed",
                          pollTimeout: 60 * 60 * 1000,
                        },
                      )
                    }
                  />
                  <TaskButton
                    label="Enrich Description"
                    busy={isBusy("enrich")}
                    onClick={() =>
                      run(
                        "enrich",
                        "/api/genres/descriptions/enrich",
                        {
                          focus_slug: genre.canonical_slug || genre.slug,
                          limit: 1,
                          force: true,
                        },
                        {
                          successMessage: (r) =>
                            r.reason === "focus_slug_not_taxonomy_node"
                              ? "Map this raw tag into the taxonomy before enriching descriptions"
                              : `Enrichment: ${r.updated ?? 0} updated`,
                          errorMessage: "Description enrichment failed",
                          pollTimeout: 45 * 60 * 1000,
                        },
                      )
                    }
                  />
                </>
              ) : null}
              {canCurateGenres ? (
                <>
                  <TaskButton
                    label="Infer Taxonomy"
                    busy={isBusy("infer")}
                    onClick={() =>
                      run(
                        "infer",
                        "/api/genres/infer",
                        {
                          focus_slug: genre.slug,
                          limit: 1,
                          aggressive: true,
                          include_external: true,
                        },
                        {
                          successMessage: (r) =>
                            `Inference: ${r.mapped ?? 0} mapped, ${
                              r.remaining_unmapped ?? 0
                            } unmapped`,
                          errorMessage: "Taxonomy inference failed",
                        },
                      )
                    }
                  />
                  <TaskButton
                    label="Clean Invalid"
                    busy={isBusy("cleanup-invalid")}
                    onClick={() =>
                      run(
                        "cleanup-invalid",
                        "/api/genres/taxonomy/cleanup-invalid",
                        {},
                        {
                          successMessage: (r) =>
                            `Cleanup: ${
                              r.deleted_count ?? 0
                            } invalid nodes removed`,
                          errorMessage: "Genre taxonomy cleanup failed",
                        },
                      )
                    }
                    icon={AlertTriangle}
                  />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteGenreOpen(true)}
                  >
                    <Trash2 size={14} className="mr-1" />
                    Delete
                  </Button>
                </>
              ) : null}
              {canCuratePlaylists &&
                (genre.artists.length > 0 || genre.albums.length > 0) && (
                  <TaskButton
                    label="Core Tracks"
                    busy={creating}
                    onClick={createSmartPlaylist}
                    icon={ListMusic}
                  />
                )}
            </div>
          ) : undefined
        }
      >
        <CrateChip icon={Users}>{genre.artists.length} artists</CrateChip>
        <CrateChip icon={Disc3}>{genre.albums.length} albums</CrateChip>
        <CrateChip
          className={
            genre.mapped
              ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-100"
              : "border-amber-500/25 bg-amber-500/10 text-amber-100"
          }
        >
          {genre.mapped ? "Mapped" : "Unmapped"}
        </CrateChip>
        {genre.canonical_name && genre.canonical_name !== genre.name ? (
          <CrateChip>Alias of {genre.canonical_name}</CrateChip>
        ) : null}
        {genre.top_level_name ? (
          <CrateChip>{genre.top_level_name}</CrateChip>
        ) : null}
      </OpsPageHero>

      <OpsPanel
        icon={Tag}
        title="Genre Context"
        description="Canonical mapping, external references and descriptive context for this node."
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div>
            {aliasNote ? (
              <p className="mb-2 text-xs italic text-white/50">{aliasNote}</p>
            ) : null}
            {taxonomyActionNote ? (
              <p className="mb-2 text-xs text-white/45">{taxonomyActionNote}</p>
            ) : null}
            {externalDescription ? (
              <div className="mt-3 rounded-md border border-white/8 bg-black/20 p-3 shadow-[0_12px_28px_rgba(0,0,0,0.16)]">
                <p className="text-xs leading-5 text-white/60">
                  {externalDescription}
                </p>
                {externalSource ? (
                  <div className="mt-1.5 text-[10px] text-white/35">
                    Source: {externalSource}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-2 rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.16)]">
            {genre.musicbrainz_mbid ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/40">MBID</span>
                <a
                  href={`https://musicbrainz.org/genre/${genre.musicbrainz_mbid}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-cyan-300/70 transition-colors hover:text-cyan-200"
                >
                  {genre.musicbrainz_mbid}
                </a>
              </div>
            ) : null}
            {genre.wikidata_url ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-white/40">Wikidata</span>
                <a
                  href={genre.wikidata_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300/70 transition-colors hover:text-cyan-200"
                >
                  {genre.wikidata_url.split("/").pop()}
                </a>
              </div>
            ) : null}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-white/40">Slug</span>
              <span className="font-mono text-[11px] text-white/50">
                {genre.slug}
              </span>
            </div>
          </div>
        </div>
      </OpsPanel>

      <TaxonomyNodeEditorialEditor
        canonicalSlug={genre.canonical_slug}
        coverUrl={genre.cover_url}
        rawSlug={genre.slug}
        rawName={genre.name}
        canCurate={canCurateGenres}
        onSaved={afterSuccess}
        onDeleted={() => navigate("/genres")}
      />

      <div>
        <GenreNetworkGraph
          key={`${genre.slug}-${graphVersion}`}
          slug={genre.slug}
        />
      </div>

      {/* Equalizer preset editor — only for canonical taxonomy nodes.
          Raw library tags inherit via their canonical alias, so there's
          nothing to edit directly on them. */}
      {canCurateGenres && genre.mapped && genre.canonical_slug && (
        <div>
          <GenreEqEditor
            canonicalSlug={genre.canonical_slug}
            canonicalName={genre.canonical_name || genre.name}
            initialGains={genre.eq_gains ?? null}
            initialResolved={genre.eq_preset_resolved ?? null}
            eqReasoning={genre.eq_reasoning}
            onSaved={refetch}
          />
        </div>
      )}

      {/* Top Artists */}
      {genre.artists.length > 0 && (
        <OpsPanel
          icon={Users}
          title="Top Artists"
          description="The artists most strongly attached to this genre node."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {genre.artists.map((a) => (
              <button
                key={a.artist_name}
                onClick={() =>
                  navigate(
                    artistPagePath({
                      artistId: a.artist_id,
                      artistSlug: a.artist_slug,
                      artistName: a.artist_name,
                    }),
                  )
                }
                className="rounded-md border border-white/8 bg-black/20 p-3 text-left shadow-[0_16px_36px_rgba(0,0,0,0.16)] transition-colors hover:border-primary"
              >
                <div className="w-full aspect-square rounded-md mb-2 overflow-hidden bg-secondary">
                  <img
                    src={artistPhotoApiUrl({
                      artistId: a.artist_id,
                      artistSlug: a.artist_slug,
                      artistName: a.artist_name,
                    })}
                    alt={a.artist_name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div className="font-semibold text-sm truncate">
                  {a.artist_name}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {a.album_count} albums
                  {a.listeners
                    ? ` · ${formatNumber(a.listeners)} listeners`
                    : ""}
                </div>
                {a.weight >= 0.8 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] mt-1 px-1 py-0"
                  >
                    primary
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </OpsPanel>
      )}

      {/* Albums */}
      {genre.albums.length > 0 && (
        <OpsPanel
          icon={Disc3}
          title="Albums"
          description="The album surface currently connected to this genre."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {genre.albums.map((a) => (
              <button
                key={a.album_id}
                onClick={() =>
                  navigate(
                    albumPagePath({
                      albumId: a.album_id,
                      albumSlug: a.album_slug,
                      artistName: a.artist,
                      albumName: a.name,
                    }),
                  )
                }
                className="overflow-hidden rounded-md border border-white/8 bg-black/20 text-left shadow-[0_16px_36px_rgba(0,0,0,0.16)] transition-colors hover:border-primary"
              >
                <div className="w-full aspect-square bg-secondary">
                  <img
                    src={albumCoverApiUrl({
                      albumId: a.album_id,
                      albumSlug: a.album_slug,
                      artistName: a.artist,
                      albumName: a.name,
                    })}
                    alt={a.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <div className="p-2.5">
                  <div className="font-medium text-sm truncate">{a.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {a.artist}
                  </div>
                  {a.year && (
                    <div className="text-[10px] text-muted-foreground">
                      {a.year}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </OpsPanel>
      )}
      <ConfirmDialog
        open={deleteGenreOpen}
        onOpenChange={setDeleteGenreOpen}
        title={`Delete ${genre.name}?`}
        description="This removes this raw genre from every artist and album that currently uses it. If this genre is an alias, the canonical taxonomy node is kept."
        confirmLabel="Delete Genre"
        variant="destructive"
        onConfirm={deleteCurrentGenre}
      />
    </div>
  );
}
