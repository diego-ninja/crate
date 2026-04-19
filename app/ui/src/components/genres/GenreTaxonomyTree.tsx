import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronRight,
  ExternalLink,
  Music,
  Search,
  SlidersHorizontal,
  Tag,
} from "lucide-react";

import { useApi } from "@/hooks/use-api";
import { EqBands } from "@shared/EqBands";
import { CratePill } from "@shared/CrateBadge";

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
    const all = new Set([...matches, ...ancestors]);
    return { visibleSlugs: all, autoExpanded: ancestors };
  }, [search, data, nodeMap]);

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

  const renderNode = (slug: string, depth: number): React.ReactNode => {
    const node = nodeMap.get(slug);
    if (!node) return null;
    if (visibleSlugs && !visibleSlugs.has(slug)) return null;

    const hasChildren = node.children_slugs.length > 0;
    const open = isExpanded(slug);
    const isSelected = selectedSlug === slug;
    const hasPreset = node.eq_gains !== null;

    return (
      <div key={slug}>
        <button
          type="button"
          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
            isSelected
              ? "border-cyan-400/40 bg-cyan-400/10"
              : "border-white/6 bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]"
          }`}
          style={{ marginLeft: depth * 16 }}
          onClick={() => {
            if (hasChildren) toggleExpand(slug);
            setSelectedSlug(isSelected ? null : slug);
          }}
        >
          {hasChildren ? (
            <ChevronRight
              size={14}
              className={`flex-shrink-0 text-white/40 transition-transform ${open ? "rotate-90" : ""}`}
            />
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          <span
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
              hasPreset ? "bg-cyan-400" : "bg-white/25"
            }`}
          />
          <span
            className={`flex-1 font-medium ${
              isSelected
                ? "text-cyan-100"
                : node.top_level
                  ? "text-white"
                  : "text-white/75"
            }`}
          >
            {node.name}
          </span>
          <span className="flex items-center gap-3 text-[11px] text-white/40">
            {node.artist_count > 0 && (
              <span>{node.artist_count} artists</span>
            )}
            <span className={hasPreset ? "text-cyan-300/80" : "text-white/35"}>
              {node.eq_preset_source === "direct"
                ? "preset"
                : node.eq_preset_source === "inherited"
                  ? "inherits"
                  : "none"}
            </span>
          </span>
        </button>

        {/* Expanded detail card */}
        {isSelected && (
          <div
            className="mt-1 mb-2 rounded-xl border border-white/8 bg-white/[0.02] p-4 space-y-4"
            style={{ marginLeft: depth * 16 + 16 }}
          >
            {/* Description */}
            {node.description && (
              <p className="text-xs leading-5 text-white/55">{node.description}</p>
            )}

            {/* Metadata */}
            <div className="flex flex-wrap gap-2">
              {node.musicbrainz_mbid && (
                <a
                  href={`https://musicbrainz.org/genre/${node.musicbrainz_mbid}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-white/55 hover:text-cyan-200 transition-colors"
                >
                  <ExternalLink size={10} />
                  MusicBrainz
                </a>
              )}
              {node.wikidata_url && (
                <a
                  href={node.wikidata_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-white/55 hover:text-cyan-200 transition-colors"
                >
                  <ExternalLink size={10} />
                  Wikidata
                </a>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-white/55 hover:text-cyan-200 transition-colors"
                onClick={() => navigate(`/genres/${slug}`)}
              >
                <Music size={10} />
                Full detail
              </button>
            </div>

            {/* Aliases */}
            {node.alias_names.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/35">
                  Aliases
                </div>
                <div className="flex flex-wrap gap-1">
                  {node.alias_names.slice(0, 12).map((alias) => (
                    <CratePill key={alias}>{alias}</CratePill>
                  ))}
                </div>
              </div>
            )}

            {/* EQ preset preview */}
            {node.eq_gains && (
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/35">
                  <SlidersHorizontal size={10} />
                  EQ Preset
                  {node.eq_preset_source === "inherited" && node.eq_preset_inherited_from && (
                    <span className="normal-case tracking-normal text-white/45">
                      (from {node.eq_preset_inherited_from})
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-white/8 bg-black/20 p-2">
                  <EqBands gains={node.eq_gains} trackHeight={64} />
                </div>
              </div>
            )}

            {/* Children as pills */}
            {node.children_slugs.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/35">
                  Subgenres
                </div>
                <div className="flex flex-wrap gap-1">
                  {node.children_slugs.map((childSlug) => {
                    const child = nodeMap.get(childSlug);
                    return child ? (
                      <CratePill
                        key={childSlug}
                        icon={Tag}
                        onClick={() => {
                          setSelectedSlug(childSlug);
                          setExpanded((prev) => new Set([...prev, slug]));
                        }}
                      >
                        {child.name}
                      </CratePill>
                    ) : null;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Children */}
        {open &&
          node.children_slugs.map((childSlug) =>
            renderNode(childSlug, depth + 1),
          )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter taxonomy..."
          className="w-full h-10 pl-9 pr-3 rounded-lg bg-white/5 text-sm text-white placeholder:text-white/25 outline-none focus:bg-white/8 border border-white/8 focus:border-white/15 transition-colors"
        />
      </div>

      {/* Tree */}
      <div className="space-y-1">
        {data.top_level_slugs.map((slug) => renderNode(slug, 0))}
      </div>
    </div>
  );
}
