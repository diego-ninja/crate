import { useCallback, useMemo, useState } from "react";
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
  SlidersHorizontal,
  Sparkles,
  Tag,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import { EqBands } from "@/components/genres/EqBands";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TaxonomyNode {
  slug: string;
  name: string;
  description: string | null;
  musicbrainz_mbid: string | null;
  wikidata_url: string | null;
  top_level: boolean;
  parent_slugs: string[];
  children_slugs: string[];
  alias_names: string[];
  artist_count: number;
  album_count: number;
  eq_gains: number[] | null;
  eq_preset_source: string | null;
  eq_preset_inherited_from: string | null;
}

interface TaxonomyTree {
  nodes: TaxonomyNode[];
  top_level_slugs: string[];
}

function matchesSearch(node: TaxonomyNode, query: string): boolean {
  const q = query.toLowerCase();
  return node.name.includes(q) || node.slug.includes(q) || node.alias_names.some((a) => a.includes(q));
}

function collectAncestors(slug: string, nodeMap: Map<string, TaxonomyNode>, result: Set<string>) {
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
}: {
  node: TaxonomyNode;
  nodeMap: Map<string, TaxonomyNode>;
  onSelectNode: (slug: string) => void;
  onNavigate: (slug: string) => void;
  onAction: (key: string) => void;
  actionBusy: (key: string) => boolean;
}) {
  const hasPreset = node.eq_gains !== null;
  const empty = node.artist_count === 0 && node.album_count === 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-foreground capitalize">{node.name}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {node.top_level && (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">top-level</Badge>
          )}
          <Badge variant="outline" className={hasPreset ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200" : "border-white/15 text-white/55"}>
            {node.eq_preset_source === "direct" ? "direct preset" : node.eq_preset_source === "inherited" ? `inherits from ${node.eq_preset_inherited_from}` : "no preset"}
          </Badge>
          {empty && (
            <Badge variant="outline" className="border-white/15 text-white/40">empty</Badge>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5"><Users size={14} />{node.artist_count} artists</span>
        <span className="flex items-center gap-1.5"><Disc3 size={14} />{node.album_count} albums</span>
      </div>

      {/* Description */}
      {node.description ? (
        <p className="text-sm leading-6 text-white/60">{node.description}</p>
      ) : (
        <p className="text-sm italic text-white/30">No description available. Run enrichment to fetch one.</p>
      )}

      {/* References */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">References</div>
        <div className="space-y-1.5">
          {node.musicbrainz_mbid ? (
            <div className="flex items-center gap-2">
              <a
                href={`https://musicbrainz.org/genre/${node.musicbrainz_mbid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-300/80 hover:text-cyan-200 transition-colors"
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
              <span className="font-mono text-[10px] text-white/25 select-all">{node.musicbrainz_mbid}</span>
            </div>
          ) : (
            <div className="text-xs text-white/30 italic">No MusicBrainz MBID — run MB sync to match.</div>
          )}
          {node.wikidata_url ? (
            <div className="flex items-center gap-2">
              <a
                href={node.wikidata_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-cyan-300/80 hover:text-cyan-200 transition-colors"
              >
                <Globe size={12} />
                Wikidata
              </a>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Slug:</span>
            <span className="font-mono text-[11px] text-white/50 select-all">{node.slug}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">Actions</div>
        <div className="flex flex-wrap gap-2">
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
          {!empty && (
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
              <Badge key={alias} variant="outline" className="text-xs">{alias}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* EQ Preset */}
      {node.eq_gains && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
            <SlidersHorizontal size={11} />
            EQ Preset
            {node.eq_preset_source === "inherited" && node.eq_preset_inherited_from && (
              <span className="normal-case tracking-normal text-white/45">
                (inherited from {node.eq_preset_inherited_from})
              </span>
            )}
          </div>
          <div className="rounded-md border border-white/8 bg-black/20 p-3">
            <EqBands gains={node.eq_gains} trackHeight={80} />
          </div>
        </div>
      )}

      {/* Parent chain */}
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
    </div>
  );
}

function ActionButton({ label, icon: Icon, busy, onClick }: {
  label: string; icon: typeof Sparkles; busy: boolean; onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" className="text-xs" onClick={onClick} disabled={busy}>
      {busy ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Icon size={12} className="mr-1" />}
      {label}
    </Button>
  );
}

// ── Main Component ──────────────────────────────────────────────

export function GenreTaxonomyTree({ filter = "" }: { filter?: string }) {
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
    if (!search.trim() || !data) return { visibleSlugs: null, autoExpanded: new Set<string>() };
    const q = search.trim().toLowerCase();
    const matches = new Set<string>();
    const ancestors = new Set<string>();
    for (const node of data.nodes) {
      if (matchesSearch(node, q)) {
        matches.add(node.slug);
        collectAncestors(node.slug, nodeMap, ancestors);
      }
    }
    return { visibleSlugs: new Set([...matches, ...ancestors]), autoExpanded: ancestors };
  }, [search, data, nodeMap]);

  const selectedNode = selectedSlug ? nodeMap.get(selectedSlug) ?? null : null;

  const runAction = useCallback((key: string) => {
    if (busy[key] || !selectedSlug) return;
    setBusy((prev) => ({ ...prev, [key]: true }));

    const actions: Record<string, { url: string; body: Record<string, unknown>; success: string; error: string }> = {
      "mb-sync": {
        url: "/api/genres/musicbrainz/sync",
        body: { limit: 80, focus_slug: selectedSlug },
        success: "MusicBrainz sync complete",
        error: "MusicBrainz sync failed",
      },
      "enrich": {
        url: "/api/genres/descriptions/enrich",
        body: { limit: 20, focus_slug: selectedSlug },
        success: "Description enrichment complete",
        error: "Description enrichment failed",
      },
      "infer": {
        url: "/api/genres/infer",
        body: { limit: 50, focus_slug: selectedSlug, aggressive: true, include_external: true },
        success: "Taxonomy inference complete",
        error: "Taxonomy inference failed",
      },
      "cleanup": {
        url: "/api/genres/taxonomy/cleanup-invalid",
        body: {},
        success: "Invalid nodes cleaned",
        error: "Cleanup failed",
      },
      "playlist": {
        url: `/api/genres/${selectedSlug}/playlist`,
        body: { limit: 50 },
        success: "Playlist generated",
        error: "Playlist generation failed",
      },
    };

    const action = actions[key];
    if (!action) { setBusy((prev) => ({ ...prev, [key]: false })); return; }

    void (async () => {
      try {
        const { task_id } = await api<{ task_id: string }>(action.url, "POST", action.body);
        pollTask(
          task_id,
          () => { setBusy((prev) => ({ ...prev, [key]: false })); refetch(); toast.success(action.success); },
          (err) => { setBusy((prev) => ({ ...prev, [key]: false })); toast.error(err || action.error); },
          3000,
          10 * 60 * 1000,
        );
      } catch {
        setBusy((prev) => ({ ...prev, [key]: false }));
        toast.error(action.error);
      }
    })();
  }, [busy, selectedSlug, pollTask, refetch]);

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

  const isExpanded = (slug: string) => expanded.has(slug) || autoExpanded.has(slug);

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

    const hasChildren = node.children_slugs.length > 0;
    const open = isExpanded(slug);
    const isSelected = selectedSlug === slug;
    const hasPreset = node.eq_gains !== null;
    const empty = node.artist_count === 0 && node.album_count === 0;

    return (
      <div key={slug}>
        <button
          type="button"
          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition ${
            isSelected
              ? "border-cyan-400/40 bg-cyan-400/10"
              : "border-transparent hover:border-white/8 hover:bg-white/[0.03]"
          }`}
          style={{ paddingLeft: depth * 16 + 10 }}
          onClick={() => setSelectedSlug(isSelected ? null : slug)}
        >
          {hasChildren ? (
            <span
              role="button"
              className="flex-shrink-0 p-0.5 rounded hover:bg-white/10"
              onClick={(e) => { e.stopPropagation(); toggleExpand(slug); }}
            >
              <ChevronRight
                size={12}
                className={`text-white/40 transition-transform ${open ? "rotate-90" : ""}`}
              />
            </span>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-md ${hasPreset ? "bg-cyan-400" : "bg-white/20"}`} />
          <span className={`flex-1 truncate ${
            isSelected ? "text-cyan-100 font-medium"
              : empty ? "text-white/40"
              : node.top_level ? "text-white font-medium"
              : "text-white/75"
          }`}>
            {node.name}
          </span>
          {node.artist_count > 0 && (
            <span className="text-[10px] tabular-nums text-white/30 flex-shrink-0">{node.artist_count}</span>
          )}
        </button>
        {open && node.children_slugs.map((childSlug) => renderNode(childSlug, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex gap-6 items-start">
      {/* Left: Tree */}
      <div className="w-80 flex-shrink-0">
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-px pr-1">
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
