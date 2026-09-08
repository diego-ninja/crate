import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  Disc3,
  Globe,
  ListMusic,
  Loader2,
  Music,
  Network,
  Save,
  Sparkles,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { ApiError, api } from "@/lib/api";
import { AIButton } from "@/components/ui/AIButton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { GenreEqEditor } from "@/components/genres/GenreEqEditor";

interface TaxonomyNode {
  slug: string;
  name: string;
  description: string | null;
  musicbrainz_mbid: string | null;
  wikidata_url: string | null;
  top_level: boolean;
  parent_slugs: string[];
  children_slugs: string[];
  related_slugs: string[];
  influenced_by_slugs: string[];
  influences_slugs: string[];
  fusion_of_slugs: string[];
  fusion_genre_slugs: string[];
  alias_names: string[];
  artist_count: number;
  album_count: number;
  eq_gains: number[] | null;
  eq_preset_source: string | null;
  eq_preset_inherited_from: string | null;
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

type RelationField = (typeof RELATION_EDITOR_CONFIG)[number]["field"];

function splitRelationSlugs(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

interface TaxonomyTree {
  nodes: TaxonomyNode[];
  top_level_slugs: string[];
}

interface TaxonomyNodeProposal {
  description: string;
  aliases: string[];
  relations: {
    relation_type: string;
    target_slugs: string[];
    confidence: number;
    reasoning: string;
  }[];
  reasoning: string;
}

interface GenreDeleteResponse {
  ok: boolean;
  removed_artist_assignments: number;
  removed_album_assignments: number;
}

function genreDeleteSummary(result: GenreDeleteResponse) {
  const assignmentCount =
    result.removed_artist_assignments + result.removed_album_assignments;
  if (assignmentCount === 0) return "Deleted genre metadata";
  return `Removed ${assignmentCount} genre assignment${
    assignmentCount === 1 ? "" : "s"
  }`;
}

function matchesSearch(node: TaxonomyNode, query: string): boolean {
  const q = query.toLowerCase();
  return (
    node.name.includes(q) ||
    node.slug.includes(q) ||
    node.alias_names.some((a) => a.includes(q))
  );
}

function collectAncestors(
  slug: string,
  nodeMap: Map<string, TaxonomyNode>,
  result: Set<string>,
) {
  const node = nodeMap.get(slug);
  if (!node) return;
  for (const parent of node.parent_slugs) {
    if (!result.has(parent)) {
      result.add(parent);
      collectAncestors(parent, nodeMap, result);
    }
  }
}

// ── Detail Panel ────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  nodeMap,
  onSelectNode,
  onNavigate,
  onAction,
  actionBusy,
  onRefetch,
  onDeleted,
  canCurate,
  canCreatePlaylists,
}: {
  node: TaxonomyNode;
  nodeMap: Map<string, TaxonomyNode>;
  onSelectNode: (slug: string) => void;
  onNavigate: (slug: string) => void;
  onAction: (key: string) => void;
  actionBusy: (key: string) => boolean;
  onRefetch?: () => void;
  onDeleted?: () => void;
  canCurate: boolean;
  canCreatePlaylists: boolean;
}) {
  const hasPreset = node.eq_gains !== null;
  const empty = node.artist_count === 0 && node.album_count === 0;
  const [descriptionDraft, setDescriptionDraft] = useState(
    node.description ?? "",
  );
  const [topLevelDraft, setTopLevelDraft] = useState(node.top_level);
  const [relationDrafts, setRelationDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [proposal, setProposal] = useState<TaxonomyNodeProposal | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setDescriptionDraft(node.description ?? "");
    setTopLevelDraft(node.top_level);
    setRelationDrafts({
      parent: (node.parent_slugs ?? []).join(", "),
      related: (node.related_slugs ?? []).join(", "),
      influenced_by: (node.influenced_by_slugs ?? []).join(", "),
      fusion_of: (node.fusion_of_slugs ?? []).join(", "),
    });
    setProposal(null);
  }, [node]);

  const saveMetadata = async () => {
    setSavingKey("metadata");
    try {
      await api(`/api/genres/taxonomy/${node.slug}`, "PATCH", {
        description: descriptionDraft,
        top_level: topLevelDraft,
      });
      toast.success("Genre metadata saved");
      onRefetch?.();
    } catch {
      toast.error("Failed to save genre metadata");
    } finally {
      setSavingKey(null);
    }
  };

  const saveRelation = async (relationType: string) => {
    setSavingKey(`relation:${relationType}`);
    try {
      const result = await api<{
        missing?: string[];
      }>(`/api/genres/taxonomy/${node.slug}/relations`, "PUT", {
        relation_type: relationType,
        target_slugs: splitRelationSlugs(relationDrafts[relationType] ?? ""),
      });
      if (result.missing?.length) {
        toast.warning(`Saved, but missing: ${result.missing.join(", ")}`);
      } else {
        toast.success("Taxonomy relation saved");
      }
      onRefetch?.();
    } catch {
      toast.error("Failed to save taxonomy relation");
    } finally {
      setSavingKey(null);
    }
  };

  const inferNodeProposal = async () => {
    setSavingKey("proposal");
    try {
      const result = await api<TaxonomyNodeProposal>(
        `/api/genres/taxonomy/${node.slug}/proposal`,
        "POST",
      );
      setProposal(result);
      if (result.description) {
        setDescriptionDraft(result.description);
      }
      if (result.relations.length > 0) {
        setRelationDrafts((prev) => {
          const next = { ...prev };
          for (const relation of result.relations) {
            next[relation.relation_type] = relation.target_slugs.join(", ");
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

  const applyProposalAliases = async () => {
    if (!proposal?.aliases.length) return;
    setSavingKey("aliases");
    try {
      const result = await api<{ applied?: string[]; skipped?: string[] }>(
        `/api/genres/taxonomy/${node.slug}/aliases`,
        "PUT",
        { alias_names: proposal.aliases },
      );
      const appliedCount = result.applied?.length ?? 0;
      const skippedCount = result.skipped?.length ?? 0;
      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} aliases`);
      } else if (skippedCount > 0) {
        toast.warning("No aliases applied");
      }
      onRefetch?.();
    } catch {
      toast.error("Failed to apply aliases");
    } finally {
      setSavingKey(null);
    }
  };

  const deleteNode = async () => {
    setSavingKey("delete-node");
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/taxonomy/${encodeURIComponent(node.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteOpen(false);
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
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground capitalize">
          {node.name}
        </h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {node.top_level && (
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/10 text-primary"
            >
              top-level
            </Badge>
          )}
          <Badge
            variant="outline"
            className={
              hasPreset
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-white/15 text-white/55"
            }
          >
            {node.eq_preset_source === "direct"
              ? "direct preset"
              : node.eq_preset_source === "inherited"
                ? `inherits from ${node.eq_preset_inherited_from}`
                : "no preset"}
          </Badge>
          {empty && (
            <Badge variant="outline" className="border-white/15 text-white/40">
              empty
            </Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Users size={14} />
          {node.artist_count} artists
        </span>
        <span className="flex items-center gap-1.5">
          <Disc3 size={14} />
          {node.album_count} albums
        </span>
      </div>

      {/* Description */}
      {node.description ? (
        <p className="text-sm leading-6 text-white/60">{node.description}</p>
      ) : (
        <p className="text-sm italic text-white/30">
          No description available. Run enrichment to fetch one.
        </p>
      )}

      {canCurate ? (
        <div className="space-y-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.035] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                Editorial node
              </div>
              <p className="mt-1 text-xs text-white/45">
                Manual edits are locked as curator truth and should not be
                overwritten by AI proposals.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <AIButton
                loading={savingKey === "proposal"}
                disabled={savingKey !== null && savingKey !== "proposal"}
                onClick={inferNodeProposal}
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
                  <Loader2 size={12} className="mr-1 animate-spin" />
                ) : (
                  <Save size={12} className="mr-1" />
                )}
                Save node
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="text-xs"
                disabled={savingKey === "delete-node"}
                onClick={() => setDeleteOpen(true)}
              >
                {savingKey === "delete-node" ? (
                  <Loader2 size={12} className="mr-1 animate-spin" />
                ) : (
                  <Trash2 size={12} className="mr-1" />
                )}
                Delete
              </Button>
            </div>
          </div>
          <label htmlFor="genre-description" className="block">
            <span className="text-[11px] uppercase tracking-wider text-white/35">
              Description
            </span>
            <textarea
              id="genre-description"
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/75 outline-none transition focus:border-cyan-400/40"
              placeholder="Short editorial description for this genre."
            />
          </label>
          <label
            htmlFor="genre-top-level"
            className="inline-flex items-center gap-2 text-xs text-white/60"
          >
            <input
              id="genre-top-level"
              type="checkbox"
              checked={topLevelDraft}
              onChange={(event) => setTopLevelDraft(event.target.checked)}
              className="h-3.5 w-3.5 accent-cyan-400"
            />
            Top-level genre
          </label>
          {proposal ? (
            <div className="rounded-lg border border-cyan-400/15 bg-black/25 p-3 text-xs text-white/55">
              <div className="font-semibold uppercase tracking-[0.16em] text-cyan-200">
                AI proposal staged
              </div>
              <p className="mt-1">
                Review the description and relation fields, then save only the
                parts you want to keep.
              </p>
              {proposal.reasoning ? (
                <p className="mt-2 text-white/40">{proposal.reasoning}</p>
              ) : null}
              {proposal.aliases.length > 0 ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {proposal.aliases.map((alias) => (
                      <Badge
                        key={alias}
                        variant="outline"
                        className="text-[10px]"
                      >
                        alias: {alias}
                      </Badge>
                    ))}
                  </div>
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
        </div>
      ) : null}

      {/* References */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
          References
        </div>
        <div className="space-y-1.5">
          {node.musicbrainz_mbid ? (
            <div className="flex items-center gap-2">
              <a
                href={`https://musicbrainz.org/genre/${node.musicbrainz_mbid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary transition-colors"
              >
                <Globe size={12} />
                MusicBrainz
              </a>
              <button
                type="button"
                className="text-white/30 hover:text-white/60 transition-colors"
                title="Copy MBID"
                onClick={() => {
                  void navigator.clipboard.writeText(node.musicbrainz_mbid!);
                  toast.success("MBID copied");
                }}
              >
                <Copy size={11} />
              </button>
              <span className="font-mono text-[10px] text-white/25 select-all">
                {node.musicbrainz_mbid}
              </span>
            </div>
          ) : (
            <div className="text-xs text-white/30 italic">
              No MusicBrainz MBID — run MB sync to match.
            </div>
          )}
          {node.wikidata_url ? (
            <div className="flex items-center gap-2">
              <a
                href={node.wikidata_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-primary/80 hover:text-primary transition-colors"
              >
                <Globe size={12} />
                Wikidata
              </a>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Slug:</span>
            <span className="font-mono text-[11px] text-white/50 select-all">
              {node.slug}
            </span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
          Actions
        </div>
        <div className="flex flex-wrap gap-2">
          {canCurate ? (
            <>
              <ActionButton
                label="Sync MusicBrainz"
                icon={Network}
                busy={actionBusy("mb-sync")}
                onClick={() => onAction("mb-sync")}
              />
              <ActionButton
                label="Enrich description"
                icon={Sparkles}
                busy={actionBusy("enrich")}
                onClick={() => onAction("enrich")}
              />
              <ActionButton
                label="Infer taxonomy"
                icon={Tag}
                busy={actionBusy("infer")}
                onClick={() => onAction("infer")}
              />
              <ActionButton
                label="Clean invalid"
                icon={AlertTriangle}
                busy={actionBusy("cleanup")}
                onClick={() => onAction("cleanup")}
              />
            </>
          ) : null}
          {canCreatePlaylists && !empty && (
            <ActionButton
              label="Generate playlist"
              icon={ListMusic}
              busy={actionBusy("playlist")}
              onClick={() => onAction("playlist")}
            />
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onNavigate(node.slug)}
          >
            <Music size={12} className="mr-1" />
            Full detail page
          </Button>
        </div>
      </div>

      {/* Aliases */}
      {node.alias_names.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
            Aliases ({node.alias_names.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.alias_names.map((alias) => (
              <Badge key={alias} variant="outline" className="text-xs">
                {alias}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* EQ Preset — full editor, same as genre detail page */}
      {canCurate ? (
        <GenreEqEditor
          canonicalSlug={node.slug}
          canonicalName={node.name}
          initialGains={node.eq_gains}
          initialResolved={
            node.eq_preset_source === "inherited" &&
            node.eq_preset_inherited_from
              ? {
                  gains: node.eq_gains ?? [],
                  source: "inherited",
                  slug: node.eq_preset_inherited_from,
                  name: node.eq_preset_inherited_from,
                }
              : node.eq_gains
                ? {
                    gains: node.eq_gains,
                    source: "direct",
                    slug: node.slug,
                    name: node.name,
                  }
                : null
          }
          onSaved={onRefetch}
        />
      ) : null}

      {/* Parent chain */}
      {canCurate ? (
        <div className="space-y-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-white/35">
            Relationship editor
          </div>
          {RELATION_EDITOR_CONFIG.map((config) => {
            const value = relationDrafts[config.key] ?? "";
            const busy = savingKey === `relation:${config.key}`;
            const current = node[config.field as RelationField] ?? [];
            const stagedProposal = proposal?.relations.find(
              (relation) => relation.relation_type === config.key,
            );
            return (
              <div
                key={config.key}
                className="rounded-lg border border-white/8 bg-black/20 p-3"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-white/75">
                      {config.label}
                    </div>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      {config.helper}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    onClick={() => saveRelation(config.key)}
                  >
                    {busy ? (
                      <Loader2 size={11} className="mr-1 animate-spin" />
                    ) : (
                      <Save size={11} className="mr-1" />
                    )}
                    Save
                  </Button>
                </div>
                <label
                  htmlFor={`genre-relation-${config.key}`}
                  className="sr-only"
                >
                  {config.label}
                </label>
                <input
                  id={`genre-relation-${config.key}`}
                  value={value}
                  onChange={(event) =>
                    setRelationDrafts((prev) => ({
                      ...prev,
                      [config.key]: event.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white/70 outline-none transition focus:border-cyan-400/40"
                  placeholder="comma-separated taxonomy slugs"
                />
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
                {current.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {current.slice(0, 8).map((slug) => (
                      <Badge
                        key={`${config.key}-${slug}`}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {nodeMap.get(slug)?.name ?? slug}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {node.parent_slugs.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
            Parent genres
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.parent_slugs.map((parentSlug) => {
              const parent = nodeMap.get(parentSlug);
              return parent ? (
                <button
                  key={parentSlug}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-white/5 transition-colors"
                  onClick={() => onSelectNode(parentSlug)}
                >
                  {parent.name}
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}

      {/* Subgenres */}
      {node.children_slugs.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
            Subgenres ({node.children_slugs.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {node.children_slugs.map((childSlug) => {
              const child = nodeMap.get(childSlug);
              return child ? (
                <button
                  key={childSlug}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-white/5 transition-colors"
                  onClick={() => onSelectNode(childSlug)}
                >
                  <Tag size={10} />
                  {child.name}
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${node.name}?`}
        description="This removes the taxonomy node, aliases, relations, and all mapped raw genre assignments from artists and albums. This cannot be undone."
        confirmLabel="Delete Genre"
        variant="destructive"
        onConfirm={deleteNode}
      />
    </div>
  );
}

function ActionButton({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof Sparkles;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-xs"
      onClick={onClick}
      disabled={busy}
    >
      {busy ? (
        <Loader2 size={12} className="mr-1 animate-spin" />
      ) : (
        <Icon size={12} className="mr-1" />
      )}
      {label}
    </Button>
  );
}

// ── Main Component ──────────────────────────────────────────────

export function GenreTaxonomyTree({
  filter = "",
  hideEmpty = false,
  canCurate = false,
  canCreatePlaylists = false,
  onChanged,
}: {
  filter?: string;
  hideEmpty?: boolean;
  canCurate?: boolean;
  canCreatePlaylists?: boolean;
  onChanged?: () => void;
}) {
  const { data, refetch } = useApi<TaxonomyTree>("/api/genres/taxonomy/tree");
  const { pollTask } = useTaskPoll();
  const navigate = useNavigate();
  const search = filter;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const nodeMap = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    for (const node of data?.nodes ?? []) map.set(node.slug, node);
    return map;
  }, [data?.nodes]);

  const { visibleSlugs, autoExpanded } = useMemo(() => {
    if (!search.trim() || !data)
      return { visibleSlugs: null, autoExpanded: new Set<string>() };
    const q = search.trim().toLowerCase();
    const matches = new Set<string>();
    const ancestors = new Set<string>();
    for (const node of data.nodes) {
      if (matchesSearch(node, q)) {
        matches.add(node.slug);
        collectAncestors(node.slug, nodeMap, ancestors);
      }
    }
    return {
      visibleSlugs: new Set([...matches, ...ancestors]),
      autoExpanded: ancestors,
    };
  }, [search, data, nodeMap]);

  const nonEmptySlugs = useMemo(() => {
    if (!hideEmpty || !data) return null;
    const set = new Set<string>();
    const visited = new Set<string>();
    function mark(slug: string): boolean {
      if (visited.has(slug)) return set.has(slug);
      visited.add(slug);
      const node = nodeMap.get(slug);
      if (!node) return false;
      const selfHasContent = node.artist_count > 0 || node.album_count > 0;
      let childHasContent = false;
      for (const child of node.children_slugs) {
        if (mark(child)) childHasContent = true;
      }
      if (selfHasContent || childHasContent) {
        set.add(slug);
        // Also mark all ancestors so parent chain is visible
        for (const parent of node.parent_slugs) {
          const p = nodeMap.get(parent);
          if (p && !set.has(parent)) {
            set.add(parent);
          }
        }
        return true;
      }
      return false;
    }
    // Walk ALL nodes, not just top-level roots
    for (const node of data.nodes) mark(node.slug);
    return set;
  }, [hideEmpty, data, nodeMap]);

  const selectedNode = selectedSlug ? nodeMap.get(selectedSlug) ?? null : null;

  const runAction = useCallback(
    (key: string) => {
      if (busy[key] || !selectedSlug) return;
      const taxonomyAction = ["mb-sync", "enrich", "infer", "cleanup"].includes(
        key,
      );
      if (taxonomyAction && !canCurate) return;
      if (key === "playlist" && !canCreatePlaylists) return;
      setBusy((prev) => ({ ...prev, [key]: true }));

      const actions: Record<
        string,
        {
          url: string;
          body: Record<string, unknown>;
          success: string;
          error: string;
        }
      > = {
        "mb-sync": {
          url: "/api/genres/musicbrainz/sync",
          body: { limit: 80, focus_slug: selectedSlug },
          success: "MusicBrainz sync complete",
          error: "MusicBrainz sync failed",
        },
        enrich: {
          url: "/api/genres/descriptions/enrich",
          body: { limit: 20, focus_slug: selectedSlug },
          success: "Description enrichment complete",
          error: "Description enrichment failed",
        },
        infer: {
          url: "/api/genres/infer",
          body: {
            limit: 50,
            focus_slug: selectedSlug,
            aggressive: true,
            include_external: true,
          },
          success: "Taxonomy inference complete",
          error: "Taxonomy inference failed",
        },
        cleanup: {
          url: "/api/genres/taxonomy/cleanup-invalid",
          body: {},
          success: "Invalid nodes cleaned",
          error: "Cleanup failed",
        },
        playlist: {
          url: `/api/genres/${selectedSlug}/playlist`,
          body: { limit: 50 },
          success: "Playlist generated",
          error: "Playlist generation failed",
        },
      };

      const action = actions[key];
      if (!action) {
        setBusy((prev) => ({ ...prev, [key]: false }));
        return;
      }

      void (async () => {
        try {
          const { task_id } = await api<{ task_id: string }>(
            action.url,
            "POST",
            action.body,
          );
          pollTask(
            task_id,
            () => {
              setBusy((prev) => ({ ...prev, [key]: false }));
              refetch();
              toast.success(action.success);
            },
            (err) => {
              setBusy((prev) => ({ ...prev, [key]: false }));
              toast.error(err || action.error);
            },
            3000,
            10 * 60 * 1000,
          );
        } catch {
          setBusy((prev) => ({ ...prev, [key]: false }));
          toast.error(action.error);
        }
      })();
    },
    [busy, canCreatePlaylists, canCurate, selectedSlug, pollTask, refetch],
  );

  const isBusy = useCallback((key: string) => !!busy[key], [busy]);

  if (!data) return null;

  const toggleExpand = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const isExpanded = (slug: string) =>
    expanded.has(slug) || autoExpanded.has(slug);

  const selectNode = (slug: string) => {
    setSelectedSlug(slug);
    const ancestors = new Set<string>();
    collectAncestors(slug, nodeMap, ancestors);
    setExpanded((prev) => new Set([...prev, ...ancestors]));
  };

  const renderNode = (slug: string, depth: number): React.ReactNode => {
    const node = nodeMap.get(slug);
    if (!node) return null;
    if (visibleSlugs && !visibleSlugs.has(slug)) return null;
    if (nonEmptySlugs && !nonEmptySlugs.has(slug)) return null;

    const hasChildren = nonEmptySlugs
      ? node.children_slugs.some((c) => nonEmptySlugs.has(c))
      : node.children_slugs.length > 0;
    const open = isExpanded(slug);
    const isSelected = selectedSlug === slug;
    const hasPreset = node.eq_gains !== null;
    const empty = node.artist_count === 0 && node.album_count === 0;

    return (
      <div key={slug}>
        <div
          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
            isSelected
              ? "border-cyan-400/40 bg-cyan-400/10"
              : "border-white/6 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
          }`}
          style={{ paddingLeft: depth * 16 + 10 }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
              className="flex-shrink-0 p-0.5 rounded hover:bg-white/10"
              onClick={() => toggleExpand(slug)}
            >
              <ChevronRight
                size={12}
                className={`text-white/40 transition-transform ${
                  open ? "rotate-90" : ""
                }`}
              />
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left text-sm"
            onClick={() => setSelectedSlug(isSelected ? null : slug)}
          >
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                empty
                  ? "bg-white/15"
                  : hasPreset
                    ? "bg-cyan-400"
                    : "bg-white/25"
              }`}
            />
            <span
              className={`flex-1 truncate font-medium ${
                isSelected
                  ? "text-cyan-100"
                  : empty
                    ? "text-white/30"
                    : node.top_level
                      ? "text-white"
                      : "text-white/75"
              }`}
            >
              {node.name}
            </span>
            {node.artist_count > 0 && (
              <span className="text-[10px] tabular-nums text-white/30 flex-shrink-0">
                {node.artist_count}
              </span>
            )}
          </button>
        </div>
        {open &&
          node.children_slugs.map((childSlug) =>
            renderNode(childSlug, depth + 1),
          )}
      </div>
    );
  };

  return (
    <div className="flex gap-6 items-start">
      {/* Left: Tree */}
      <div className="w-80 flex-shrink-0">
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-1 pr-1">
          {data.top_level_slugs.map((slug) => renderNode(slug, 0))}
        </div>
      </div>

      {/* Right: Detail */}
      <div className="flex-1 min-w-0">
        {selectedNode ? (
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-6 sticky top-6">
            <NodeDetailPanel
              node={selectedNode}
              nodeMap={nodeMap}
              onSelectNode={selectNode}
              onNavigate={(slug) => navigate(`/genres/${slug}`)}
              onAction={runAction}
              actionBusy={isBusy}
              onRefetch={refetch}
              onDeleted={() => {
                setSelectedSlug(null);
                refetch();
                onChanged?.();
              }}
              canCurate={canCurate}
              canCreatePlaylists={canCreatePlaylists}
            />
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-white/10 text-sm text-white/30">
            Select a genre to view details
          </div>
        )}
      </div>
    </div>
  );
}
