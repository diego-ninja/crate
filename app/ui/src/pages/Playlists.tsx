import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Layers3,
  ListMusic,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@/components/ui/CrateBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface SystemPlaylist {
  id: number;
  name: string;
  description: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  generation_mode: "static" | "smart";
  is_curated: boolean;
  is_active: boolean;
  featured_rank?: number | null;
  category?: string | null;
  follower_count: number;
  track_count: number;
  total_duration: number;
  generation_status?: string;
  last_generated_at?: string | null;
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  artists: string[];
}

interface DraftSmartRule {
  field: string;
  op: string;
  value: string;
  rangeMin: string;
  rangeMax: string;
}

type FilterMode = "all" | "curated" | "smart" | "inactive";
type ComposerMode = "static" | "smart" | null;

const FILTER_OPTIONS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "curated", label: "Curated" },
  { key: "smart", label: "Smart" },
  { key: "inactive", label: "Inactive" },
];

const CATEGORY_OPTIONS = [
  { value: "editorial", label: "Editorial" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
  { value: "activity", label: "Activity" },
  { value: "era", label: "Era" },
  { value: "seasonal", label: "Seasonal" },
];

const SMART_FIELDS = [
  { value: "genre", label: "Genre", type: "text" },
  { value: "artist", label: "Artist", type: "text" },
  { value: "album", label: "Album", type: "text" },
  { value: "title", label: "Title", type: "text" },
  { value: "format", label: "Format", type: "text" },
  { value: "audio_key", label: "Key", type: "text" },
  { value: "year", label: "Year", type: "number" },
  { value: "bpm", label: "BPM", type: "number" },
  { value: "energy", label: "Energy", type: "number" },
  { value: "danceability", label: "Danceability", type: "number" },
  { value: "valence", label: "Valence", type: "number" },
  { value: "acousticness", label: "Acousticness", type: "number" },
  { value: "popularity", label: "Popularity", type: "number" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "duration", label: "Duration", type: "number" },
] as const;

const TEXT_OPS = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not contains" },
];

const NUMBER_OPS = [
  { value: "eq", label: "=" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "between", label: "Between" },
];

const SORT_OPTIONS = [
  { value: "random", label: "Random" },
  { value: "popularity", label: "Popularity" },
  { value: "energy", label: "Energy" },
  { value: "bpm", label: "BPM" },
  { value: "title", label: "Title" },
];

const DROPDOWN_FIELDS: Record<
  string,
  { optionsKey: keyof FilterOptions; searchPlaceholder: string; placeholder: string }
> = {
  artist: { optionsKey: "artists", searchPlaceholder: "Search artists...", placeholder: "Select artist" },
  genre: { optionsKey: "genres", searchPlaceholder: "Search genres...", placeholder: "Select genre" },
  format: { optionsKey: "formats", searchPlaceholder: "Search formats...", placeholder: "Select format" },
  audio_key: { optionsKey: "keys", searchPlaceholder: "Search keys...", placeholder: "Select key" },
};

function fmtDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getFieldType(field: string): "text" | "number" {
  return SMART_FIELDS.find((item) => item.value === field)?.type === "text" ? "text" : "number";
}

function getOpsForField(field: string) {
  return getFieldType(field) === "text" ? TEXT_OPS : NUMBER_OPS;
}

function getGenerationChip(status?: string) {
  if (status === "running") {
    return <CrateChip active className="text-[11px]">Generating</CrateChip>;
  }
  if (status === "queued") {
    return (
      <CrateChip className="border-amber-400/25 bg-amber-400/10 text-[11px] text-amber-200">
        Queued
      </CrateChip>
    );
  }
  if (status === "failed") {
    return (
      <CrateChip className="border-red-400/25 bg-red-500/10 text-[11px] text-red-200">
        Failed
      </CrateChip>
    );
  }
  return null;
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <CratePill active={active} onClick={onClick}>
      {label}
    </CratePill>
  );
}

export function Playlists() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<SystemPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemPlaylist | null>(null);

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<SystemPlaylist[]>("/api/admin/system-playlists");
      setPlaylists(Array.isArray(data) ? data : []);
    } catch {
      setPlaylists([]);
      toast.error("Failed to load system playlists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlaylists();
  }, [fetchPlaylists]);

  const counts = useMemo(
    () => ({
      all: playlists.length,
      curated: playlists.filter((playlist) => playlist.is_curated).length,
      smart: playlists.filter((playlist) => playlist.generation_mode === "smart").length,
      inactive: playlists.filter((playlist) => !playlist.is_active).length,
    }),
    [playlists],
  );

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(
        playlists
          .map((playlist) => playlist.category?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return categories.map((category) => ({ value: category, label: category }));
  }, [playlists]);

  const filteredPlaylists = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return playlists.filter((playlist) => {
      const matchesMode = filter === "all"
        || (filter === "curated" && playlist.is_curated)
        || (filter === "smart" && playlist.generation_mode === "smart")
        || (filter === "inactive" && !playlist.is_active);

      if (!matchesMode) return false;

      if (categoryFilter && (playlist.category ?? "") !== categoryFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        playlist.name,
        playlist.description,
        playlist.category,
        playlist.generation_mode,
        playlist.is_curated ? "curated" : "",
        playlist.is_active ? "active" : "inactive",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [categoryFilter, filter, playlists, query]);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/admin/system-playlists/${deleteTarget.id}`, "DELETE");
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      void fetchPlaylists();
    } catch {
      toast.error("Failed to delete system playlist");
    }
  }

  async function toggleActive(playlist: SystemPlaylist) {
    try {
      await api(
        `/api/admin/system-playlists/${playlist.id}/${playlist.is_active ? "deactivate" : "activate"}`,
        "POST",
      );
      toast.success(playlist.is_active ? "Playlist deactivated" : "Playlist activated");
      void fetchPlaylists();
    } catch {
      toast.error("Failed to update status");
    }
  }

  function handleCreated(playlist: SystemPlaylist) {
    setComposerMode(null);
    void fetchPlaylists();
    navigate(`/playlists/${playlist.id}`);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <Layers3 size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">System Playlists</h1>
                <p className="text-sm text-muted-foreground">
                  Editorial playlists for `listen`, with smart generation and admin-only controls.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={composerMode === "static" ? "default" : "outline"}
              onClick={() => setComposerMode((current) => (current === "static" ? null : "static"))}
            >
              <Plus size={14} className="mr-1" /> New static
            </Button>
            <Button
              size="sm"
              variant={composerMode === "smart" ? "default" : "outline"}
              onClick={() => setComposerMode((current) => (current === "smart" ? null : "smart"))}
            >
              <Sparkles size={14} className="mr-1" /> New smart
            </Button>
          </div>
        </div>

        <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search playlists by name, description or category"
                className="pl-9"
              />
            </div>
            <AdminSelect
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categoryOptions}
              placeholder="All categories"
              searchable
              searchPlaceholder="Search categories..."
              triggerClassName="w-full lg:w-[220px]"
            />
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((item) => (
                <CratePill
                  key={item.key}
                  active={filter === item.key}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                  <span className="text-white/40">
                    {item.key === "all"
                      ? counts.all
                      : item.key === "curated"
                        ? counts.curated
                        : item.key === "smart"
                          ? counts.smart
                          : counts.inactive}
                  </span>
                </CratePill>
              ))}
            </div>

            <p className="text-sm text-muted-foreground">
              Showing {filteredPlaylists.length} of {playlists.length} playlists
            </p>
          </div>
        </div>
      </section>

      {composerMode === "static" ? (
        <CreateStaticPlaylistPanel onCreated={handleCreated} onCancel={() => setComposerMode(null)} />
      ) : null}

      {composerMode === "smart" ? (
        <CreateSmartPlaylistPanel onCreated={handleCreated} onCancel={() => setComposerMode(null)} />
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading playlists…
        </div>
      ) : filteredPlaylists.length === 0 ? (
        <Card className="border-white/10 bg-card p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/35">
            <ListMusic size={20} />
          </div>
          <h2 className="mt-4 text-lg font-medium">No playlists for this view yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different search or filter, or start a new playlist from the composer above.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredPlaylists.map((playlist) => (
            <Card key={playlist.id} className="overflow-hidden border-white/10 bg-card">
              <div
                className="flex cursor-pointer flex-col gap-4 px-4 py-4 transition-colors hover:bg-white/[0.03] lg:flex-row lg:items-stretch"
                onClick={() => navigate(`/playlists/${playlist.id}`)}
              >
                <PlaylistArtwork
                  name={playlist.name}
                  coverDataUrl={playlist.cover_data_url}
                  tracks={playlist.artwork_tracks}
                  className="h-24 w-24 shrink-0 rounded-md border border-white/10 bg-white/[0.03] lg:h-auto lg:min-h-[104px] lg:w-[104px]"
                />

                <div className="min-w-0 flex-1 space-y-2 lg:flex lg:flex-col lg:justify-center">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-sm font-semibold md:text-base">{playlist.name}</h2>
                    <CrateChip>system</CrateChip>
                    <CrateChip active={playlist.generation_mode === "smart"}>
                      {playlist.generation_mode}
                    </CrateChip>
                    {playlist.is_curated ? <CrateChip>curated</CrateChip> : null}
                    {!playlist.is_active ? <CrateChip>inactive</CrateChip> : null}
                    {playlist.category ? <CrateChip>{playlist.category}</CrateChip> : null}
                    {getGenerationChip(playlist.generation_status)}
                  </div>

                  {playlist.description ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{playlist.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {playlist.generation_mode === "smart"
                        ? "Rule-driven editorial playlist."
                        : "Static editorial playlist shell."}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <CrateChip className="text-[11px]">{playlist.track_count} tracks</CrateChip>
                    <CrateChip className="text-[11px]">{fmtDuration(playlist.total_duration)}</CrateChip>
                    <CrateChip className="text-[11px]">
                      {playlist.follower_count} follower{playlist.follower_count === 1 ? "" : "s"}
                    </CrateChip>
                    {playlist.featured_rank != null ? (
                      <CrateChip className="text-[11px]">Rank {playlist.featured_rank}</CrateChip>
                    ) : null}
                    {playlist.last_generated_at ? (
                      <CrateChip className="text-[11px]">
                        Generated {timeAgo(playlist.last_generated_at)}
                      </CrateChip>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => navigate(`/playlists/${playlist.id}`)}>
                    Open editor <ArrowRight size={14} className="ml-1" />
                  </Button>
                  <ActionIconButton
                    variant="row"
                    className="h-8 w-8"
                    onClick={() => {
                      void toggleActive(playlist);
                    }}
                  >
                    {playlist.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                  </ActionIconButton>
                  <ActionIconButton
                    variant="row"
                    tone="danger"
                    className="h-8 w-8"
                    onClick={() => setDeleteTarget(playlist)}
                  >
                    <Trash2 size={14} />
                  </ActionIconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete system playlist"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function CreateStaticPlaylistPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (playlist: SystemPlaylist) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [isCurated, setIsCurated] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const playlist = await api<SystemPlaylist>("/api/admin/system-playlists", "POST", {
        name: name.trim(),
        description: description.trim(),
        category,
        featured_rank: featuredRank.trim() ? Number(featuredRank) : null,
        generation_mode: "static",
        is_curated: isCurated,
        is_active: isActive,
      });
      toast.success("Static playlist created");
      onCreated(playlist);
    } catch {
      toast.error("Failed to create static playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-white/10 bg-card p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-primary">
                <Plus size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">New static playlist</h2>
                <p className="text-sm text-muted-foreground">
                  Create the editorial shell, then continue in the dedicated editor.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <TogglePill label="Curated in listen" active={isCurated} onClick={() => setIsCurated((v) => !v)} />
              <TogglePill label="Active" active={isActive} onClick={() => setIsActive((v) => !v)} />
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X size={14} className="mr-1" /> Close
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_180px]">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Playlist name" />
          </Field>
          <Field label="Category">
            <AdminSelect
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
              placeholder="Category"
              allowClear={false}
              triggerClassName="w-full max-w-none"
            />
          </Field>
          <Field label="Featured rank">
            <Input
              type="number"
              value={featuredRank}
              onChange={(event) => setFeaturedRank(event.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Description" className="lg:col-span-3">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short editorial description for listen"
              rows={4}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Static playlists open in the editor right after creation so cover and editorial metadata stay in the same workflow.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || !name.trim()}>
              {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}
              Create & open
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CreateSmartPlaylistPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (playlist: SystemPlaylist) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [isCurated, setIsCurated] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [rules, setRules] = useState<DraftSmartRule[]>([
    { field: "genre", op: "contains", value: "", rangeMin: "", rangeMax: "" },
  ]);
  const [limit, setLimit] = useState("50");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sort, setSort] = useState("random");
  const [saving, setSaving] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);

  useEffect(() => {
    api<FilterOptions>("/api/playlists/filter-options").then(setFilterOptions).catch(() => {});
  }, []);

  function updateRule(index: number, patch: Partial<DraftSmartRule>) {
    setRules((current) => current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)));
  }

  function addRule() {
    setRules((current) => [
      ...current,
      { field: "genre", op: "contains", value: "", rangeMin: "", rangeMax: "" },
    ]);
  }

  function removeRule(index: number) {
    setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
  }

  function updateRuleField(index: number, field: string) {
    const nextOp = getOpsForField(field)[0]?.value ?? "eq";
    updateRule(index, { field, op: nextOp, value: "", rangeMin: "", rangeMax: "" });
  }

  function ruleHasValue(rule: DraftSmartRule) {
    if (rule.op === "between") {
      return rule.rangeMin.trim() !== "" || rule.rangeMax.trim() !== "";
    }
    return rule.value.trim() !== "";
  }

  async function submit() {
    if (!name.trim()) return;
    const payloadRules = rules
      .filter(ruleHasValue)
      .map((rule) => {
        if (rule.op === "between") {
          const min = rule.rangeMin.trim() ? Number(rule.rangeMin) : 0;
          const max = rule.rangeMax.trim() ? Number(rule.rangeMax) : 9999;
          return { field: rule.field, op: "between", value: [min, max] as [number, number] };
        }
        if (getFieldType(rule.field) === "number") {
          return { field: rule.field, op: rule.op, value: Number(rule.value) };
        }
        return { field: rule.field, op: rule.op, value: rule.value.trim() };
      });

    if (payloadRules.length === 0) {
      toast.error("Add at least one smart rule");
      return;
    }

    setSaving(true);
    try {
      const playlist = await api<SystemPlaylist>("/api/admin/system-playlists", "POST", {
        name: name.trim(),
        description: description.trim(),
        category,
        featured_rank: featuredRank.trim() ? Number(featuredRank) : null,
        generation_mode: "smart",
        is_curated: isCurated,
        is_active: isActive,
        auto_refresh_enabled: autoRefreshEnabled,
        smart_rules: {
          match,
          rules: payloadRules,
          limit: Number(limit) || 50,
          sort,
        },
      });
      toast.success("Smart playlist created and queued");
      onCreated(playlist);
    } catch {
      toast.error("Failed to create smart playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-white/10 bg-card p-5 shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary">
                <Sparkles size={18} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">New smart playlist</h2>
                <p className="text-sm text-muted-foreground">
                  Define the editorial shell, add rules, and jump straight into the editor once generation is queued.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <TogglePill label="Curated in listen" active={isCurated} onClick={() => setIsCurated((v) => !v)} />
              <TogglePill label="Active" active={isActive} onClick={() => setIsActive((v) => !v)} />
              <TogglePill
                label="Auto-refresh daily"
                active={autoRefreshEnabled}
                onClick={() => setAutoRefreshEnabled((v) => !v)}
              />
            </div>
          </div>

          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X size={14} className="mr-1" /> Close
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_180px]">
          <Field label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Playlist name" />
          </Field>
          <Field label="Category">
            <AdminSelect
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
              placeholder="Category"
              allowClear={false}
              triggerClassName="w-full max-w-none"
            />
          </Field>
          <Field label="Featured rank">
            <Input
              type="number"
              value={featuredRank}
              onChange={(event) => setFeaturedRank(event.target.value)}
              placeholder="Optional"
            />
          </Field>
          <Field label="Description" className="lg:col-span-3">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Editorial summary shown in listen"
              rows={4}
            />
          </Field>
        </div>

        <div className="rounded-md border border-white/10 bg-black/10 p-4">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h3 className="text-sm font-semibold">Rule composer</h3>
              <p className="text-sm text-muted-foreground">
                Build the first pass here, then refine in the editor after creation if needed.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Field label="Match" className="min-w-[180px]">
                <AdminSelect
                  value={match}
                  onChange={(value) => setMatch(value as "all" | "any")}
                  options={[
                    { value: "all", label: "All rules" },
                    { value: "any", label: "Any rule" },
                  ]}
                  placeholder="Match"
                  allowClear={false}
                  triggerClassName="w-full max-w-none"
                />
              </Field>
              <Field label="Limit" className="w-[120px]">
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                />
              </Field>
              <Field label="Sort" className="min-w-[180px]">
                <AdminSelect
                  value={sort}
                  onChange={setSort}
                  options={SORT_OPTIONS}
                  placeholder="Sort"
                  allowClear={false}
                  triggerClassName="w-full max-w-none"
                />
              </Field>
            </div>
          </div>

          <div className="space-y-3">
            {rules.map((rule, index) => {
              const ops = getOpsForField(rule.field);
              const dropdownConfig = DROPDOWN_FIELDS[rule.field];
              const dropdownOptions = dropdownConfig && filterOptions
                ? filterOptions[dropdownConfig.optionsKey].map((value) => ({ value, label: value }))
                : [];

              return (
                <div
                  key={`${rule.field}-${index}`}
                  className="rounded-md border border-white/10 bg-card/60 p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <CrateChip className="text-[11px]">Rule {index + 1}</CrateChip>
                    <ActionIconButton
                      variant="row"
                      tone="danger"
                      className="h-8 w-8"
                      onClick={() => removeRule(index)}
                      disabled={rules.length === 1}
                    >
                      <Trash2 size={14} />
                    </ActionIconButton>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[180px_160px_minmax(0,1fr)]">
                    <Field label="Field">
                      <AdminSelect
                        value={rule.field}
                        onChange={(value) => updateRuleField(index, value)}
                        options={SMART_FIELDS.map((field) => ({ value: field.value, label: field.label }))}
                        placeholder="Field"
                        allowClear={false}
                        triggerClassName="w-full max-w-none"
                      />
                    </Field>

                    <Field label="Operator">
                      <AdminSelect
                        value={rule.op}
                        onChange={(value) => updateRule(index, { op: value, value: "", rangeMin: "", rangeMax: "" })}
                        options={ops}
                        placeholder="Operator"
                        allowClear={false}
                        triggerClassName="w-full max-w-none"
                      />
                    </Field>

                    <Field label="Value">
                      {rule.op === "between" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            type="number"
                            value={rule.rangeMin}
                            onChange={(event) => updateRule(index, { rangeMin: event.target.value })}
                            placeholder="Minimum"
                          />
                          <Input
                            type="number"
                            value={rule.rangeMax}
                            onChange={(event) => updateRule(index, { rangeMax: event.target.value })}
                            placeholder="Maximum"
                          />
                        </div>
                      ) : dropdownConfig ? (
                        <AdminSelect
                          value={rule.value}
                          onChange={(value) => updateRule(index, { value })}
                          options={dropdownOptions}
                          placeholder={dropdownConfig.placeholder}
                          searchable
                          searchPlaceholder={dropdownConfig.searchPlaceholder}
                          allowClear={false}
                          triggerClassName="w-full max-w-none"
                        />
                      ) : (
                        <Input
                          value={rule.value}
                          onChange={(event) => updateRule(index, { value: event.target.value })}
                          placeholder="Value"
                        />
                      )}
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <p className="text-sm text-muted-foreground">
              Prefer one condition per rule. If you need multiple buckets, create more rules and switch match mode to `Any`.
            </p>
            <Button variant="outline" size="sm" onClick={addRule}>
              <Plus size={14} className="mr-1" /> Add rule
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Smart playlists queue their first generation immediately, then you continue in the editor for cover, status and later refinements.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || !name.trim()}>
              {saving ? (
                <Loader2 size={14} className="mr-1 animate-spin" />
              ) : (
                <Sparkles size={14} className="mr-1" />
              )}
              Create & open
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
