import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

import { CrateChip } from "@crate/ui/primitives/CrateBadge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crate/ui/shadcn/popover";
import { Input } from "@crate/ui/shadcn/input";
import { cn } from "@crate/ui/lib/cn";

import { useApi } from "@/hooks/use-api";

interface TaxonomyNode {
  slug: string;
  name: string;
  description?: string | null;
  top_level: boolean;
  parent_slugs: string[];
  alias_names: string[];
}

interface TaxonomyTreeResponse {
  nodes: TaxonomyNode[];
}

export function filterTaxonomyNodes(
  nodes: TaxonomyNode[],
  search: string,
): TaxonomyNode[] {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return nodes;
  return nodes.filter((node) =>
    [node.name, node.slug, ...node.alias_names]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

interface ArtistGenreSelectorProps {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

export function ArtistGenreSelector({
  value,
  onChange,
  disabled = false,
}: ArtistGenreSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, loading, error } = useApi<TaxonomyTreeResponse>(
    open ? "/api/genres/taxonomy/tree" : null,
  );
  const nodes = data?.nodes ?? [];
  const filteredNodes = useMemo(
    () => filterTaxonomyNodes(nodes, search),
    [nodes, search],
  );
  const labels = new Map(nodes.map((node) => [node.slug, node.name]));

  function toggle(slug: string) {
    onChange(
      value.includes(slug)
        ? value.filter((current) => current !== slug)
        : [...value, slug],
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Genres"
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-md border border-white/10 bg-black/25 px-3 text-left text-sm transition-colors hover:border-white/20",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {value.length ? (
              value.map((slug) => (
                <CrateChip key={slug} active className="max-w-[180px] truncate">
                  {labels.get(slug) ?? slug}
                </CrateChip>
              ))
            ) : (
              <span className="text-white/40">Select canonical genres</span>
            )}
          </span>
          <ChevronDown size={15} className="shrink-0 text-white/35" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        layer="dropdown"
        className="w-[min(420px,calc(100vw-2rem))] overflow-hidden p-2"
      >
        <div className="border-b border-white/5 px-1 pb-2">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
            />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search taxonomy genres..."
              className="h-10 border-white/10 bg-black/25 pl-9"
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {loading ? (
            <p className="px-3 py-5 text-sm text-white/45">
              Loading taxonomy...
            </p>
          ) : error ? (
            <p className="px-3 py-5 text-sm text-red-300">
              Failed to load taxonomy.
            </p>
          ) : filteredNodes.length ? (
            filteredNodes.map((node) => {
              const selected = value.includes(node.slug);
              return (
                <button
                  key={node.slug}
                  type="button"
                  onClick={() => toggle(node.slug)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]",
                    selected && "bg-primary/10 text-primary",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/20",
                      selected && "border-primary bg-primary text-black",
                    )}
                  >
                    {selected ? <Check size={12} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{node.name}</span>
                    <span className="block truncate text-[11px] text-white/35">
                      {node.slug}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-5 text-center text-sm text-white/40">
              No matching genres
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
