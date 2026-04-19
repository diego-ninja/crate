import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronRight,
  Disc3,
  ExternalLink,
  Music,
  Search,
  SlidersHorizontal,
  Tag,
  Users,
} from "lucide-react";

import { useApi } from "@/hooks/use-api";
import { EqBands } from "@/components/genres/EqBands";
import { Badge } from "@/components/ui/badge";

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
  if (node.name.includes(q)) return true;
  if (node.slug.includes(q)) return true;
  return node.alias_names.some((a) => a.includes(q));
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
}: {
  node: TaxonomyNode;
  nodeMap: Map<string, TaxonomyNode>;
  onSelectNode: (slug: string) => void;
  onNavigate: (slug: string) => void;
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
      {node.description && (
        <p className="text-sm leading-6 text-white/60">{node.description}</p>
      )}

      {/* Links */}
      <div className="flex flex-wrap gap-2">
        {node.musicbrainz_mbid && (
          <a
            href={`https://musicbrainz.org/genre/${node.musicbrainz_mbid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/55 hover:text-cyan-200 transition-colors"
          >
            <ExternalLink size={12} />
            MusicBrainz
          </a>
        )}
        {node.wikidata_url && (
          <a
            href={node.wikidata_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-white/55 hover:text-cyan-200 transition-colors"
          >
            <ExternalLink size={12} />
            Wikidata
          </a>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors"
          onClick={() => onNavigate(node.slug)}
        >
          <Music size={12} />
          Open genre page
        </button>
      </div>

      {/* Aliases */}
      {node.alias_names.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-white/35">
            Aliases
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
          </div>
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <EqBands gains={node.eq_gains} trackHeight={80} />
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
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:bg-white/5 transition-colors"
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
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-foreground hover:bg-white/5 transition-colors"
                  onClick={() => onSelectNode(parentSlug)}
                >
                  {parent.name}
                </button>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────

export function GenreTaxonomyTree() {
  const { data } = useApi<TaxonomyTree>("/api/genres/taxonomy/tree");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

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
    // Ensure all ancestors are expanded so the node is visible
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
          className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition ${
            isSelected
              ? "border-cyan-400/40 bg-cyan-400/10"
              : "border-transparent hover:border-white/8 hover:bg-white/[0.03]"
          }`}
          style={{ paddingLeft: depth * 16 + 10 }}
          onClick={() => {
            setSelectedSlug(isSelected ? null : slug);
          }}
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
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
              hasPreset ? "bg-cyan-400" : "bg-white/20"
            }`}
          />
          <span
            className={`flex-1 truncate ${
              isSelected
                ? "text-cyan-100 font-medium"
                : empty
                  ? "text-white/40"
                  : node.top_level
                    ? "text-white font-medium"
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

        {open &&
          node.children_slugs.map((childSlug) =>
            renderNode(childSlug, depth + 1),
          )}
      </div>
    );
  };

  return (
    <div className="flex gap-6 items-start">
      {/* Left: Tree navigation */}
      <div className="w-80 flex-shrink-0 space-y-2">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search genres..."
            className="w-full h-9 pl-9 pr-3 rounded-lg bg-white/5 text-sm text-white placeholder:text-white/25 outline-none focus:bg-white/8 border border-white/8 focus:border-white/15 transition-colors"
          />
        </div>

        <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-px pr-1">
          {data.top_level_slugs.map((slug) => renderNode(slug, 0))}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div className="flex-1 min-w-0">
        {selectedNode ? (
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-6 sticky top-6">
            <NodeDetailPanel
              node={selectedNode}
              nodeMap={nodeMap}
              onSelectNode={selectNode}
              onNavigate={(slug) => navigate(`/genres/${slug}`)}
            />
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/30">
            Select a genre to view details
          </div>
        )}
      </div>
    </div>
  );
}
