import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Copy,
  ImagePlus,
  ListMusic,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { PlaylistArtwork, type PlaylistArtworkTrack } from "@/components/playlists/PlaylistArtwork";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface Playlist {
  id: number;
  name: string;
  description: string | null;
  generation_mode: "static" | "smart";
  is_smart: boolean;
  is_active: boolean;
  is_curated: boolean;
  auto_refresh_enabled: boolean;
  category: string | null;
  featured_rank: number | null;
  track_count: number;
  total_duration: number;
  follower_count: number;
  smart_rules: SmartRules | null;
  generation_status: string;
  generation_error: string | null;
  last_generated_at: string | null;
  cover_data_url: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  tracks: Track[];
}

interface SmartRules {
  match: "all" | "any";
  rules: SmartRule[];
  limit: number;
  sort: string;
}

interface SmartRule {
  field: string;
  op: string;
  value: string | number | (string | number)[];
}

interface Track {
  id?: number;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
}

interface GenerationLog {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  track_count: number | null;
  duration_sec: number | null;
  error: string | null;
  triggered_by: string;
}

interface PreviewTrack {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number | null;
  year?: number | null;
  format?: string | null;
}

interface PreviewResult {
  total_matching: number;
  tracks: PreviewTrack[];
  genre_distribution: Record<string, number>;
  artist_distribution: Record<string, number>;
  format_distribution: Record<string, number>;
  duration_total_sec: number;
  avg_year: number | null;
  year_range: number[] | null;
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  artists: string[];
}

const CATEGORY_OPTIONS = [
  { value: "editorial", label: "Editorial" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
  { value: "activity", label: "Activity" },
  { value: "era", label: "Era" },
  { value: "seasonal", label: "Seasonal" },
];

const RULE_FIELDS = [
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

function getFieldType(field: string): "text" | "number" {
  return RULE_FIELDS.find((item) => item.value === field)?.type === "text" ? "text" : "number";
}

function getOpsForField(field: string) {
  return getFieldType(field) === "text" ? TEXT_OPS : NUMBER_OPS;
}

function formatMinutes(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTrackDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remaining = String(wholeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
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

function StatusChip({ status }: { status: string }) {
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
  return <CrateChip className="text-[11px]">Idle</CrateChip>;
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/15 p-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function DistributionBlock({
  label,
  items,
}: {
  label: string;
  items: Array<[string, number]>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map(([name, count]) => (
          <CrateChip key={name} className="text-[11px]">
            {name} <span className="text-white/35">{count}</span>
          </CrateChip>
        ))}
      </div>
    </div>
  );
}

export function PlaylistEditor() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const id = Number(playlistId);

  const {
    data: playlist,
    loading,
    refetch,
  } = useApi<Playlist>(id ? `/api/admin/system-playlists/${id}` : null);
  const {
    data: history,
    refetch: refetchHistory,
  } = useApi<GenerationLog[]>(id ? `/api/admin/system-playlists/${id}/generation-history` : null);
  const { data: filterOptions } = useApi<FilterOptions>("/api/playlists/filter-options");

  useEffect(() => {
    const status = playlist?.generation_status;
    if (status !== "queued" && status !== "running") return;
    const interval = setInterval(() => {
      void refetch();
      void refetchHistory();
    }, 3000);
    return () => clearInterval(interval);
  }, [playlist?.generation_status, refetch, refetchHistory]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [featuredRank, setFeaturedRank] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isCurated, setIsCurated] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rules, setRules] = useState<SmartRule[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState("random");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!playlist) return;
    setName(playlist.name);
    setDescription(playlist.description || "");
    setCategory(playlist.category || "");
    setFeaturedRank(playlist.featured_rank);
    setIsActive(playlist.is_active);
    setIsCurated(playlist.is_curated);
    setAutoRefresh(playlist.auto_refresh_enabled);
    if (playlist.smart_rules) {
      setRules(playlist.smart_rules.rules || []);
      setMatch(playlist.smart_rules.match || "all");
      setLimit(playlist.smart_rules.limit || 50);
      setSort(playlist.smart_rules.sort || "random");
    } else {
      setRules([]);
      setMatch("all");
      setLimit(50);
      setSort("random");
    }
  }, [playlist]);

  const isSmart = playlist?.is_smart ?? false;
  const persistedSmartRules = playlist?.smart_rules;
  const currentSmartRules = { match, rules, limit, sort };
  const smartRulesChanged = isSmart
    && JSON.stringify(currentSmartRules) !== JSON.stringify(persistedSmartRules ?? null);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        description: description || null,
        category: category || null,
        featured_rank: featuredRank,
        is_active: isActive,
        is_curated: isCurated,
      };
      if (isSmart) {
        body.smart_rules = currentSmartRules;
        body.auto_refresh_enabled = autoRefresh;
      }
      await api(`/api/admin/system-playlists/${id}`, "PUT", body);
      toast.success("Playlist saved");
      void refetch();
      void refetchHistory();
    } catch {
      toast.error("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }, [
    autoRefresh,
    category,
    description,
    featuredRank,
    id,
    isActive,
    isCurated,
    isSmart,
    limit,
    match,
    name,
    currentSmartRules,
    refetch,
    refetchHistory,
  ]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      if (smartRulesChanged) {
        await api(`/api/admin/system-playlists/${id}`, "PUT", {
          smart_rules: currentSmartRules,
          auto_refresh_enabled: autoRefresh,
        });
        toast.success("Rules saved and generation enqueued");
      } else {
        await api(`/api/admin/system-playlists/${id}/generate`, "POST");
        toast.success("Generation enqueued");
      }
      void refetch();
      void refetchHistory();
    } catch {
      toast.error("Failed to enqueue generation");
    } finally {
      setGenerating(false);
    }
  }, [autoRefresh, currentSmartRules, id, refetch, refetchHistory, smartRulesChanged]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await api<PreviewResult>(`/api/admin/system-playlists/${id}/preview`, "POST", {
        smart_rules: currentSmartRules,
      });
      setPreview(result);
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewing(false);
    }
  }, [currentSmartRules, id]);

  const handleDuplicate = useCallback(async () => {
    try {
      const result = await api<{ id: number }>(`/api/admin/system-playlists/${id}/duplicate`, "POST");
      toast.success("Playlist duplicated");
      navigate(`/playlists/${result.id}`);
    } catch {
      toast.error("Failed to duplicate playlist");
    }
  }, [id, navigate]);

  const handleCoverUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadingCover(true);
      try {
        const reader = new FileReader();
        const encoded = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        await api(`/api/admin/system-playlists/${id}`, "PUT", { cover_data_url: encoded });
        toast.success("Cover upload started");
        void refetch();
      } catch {
        toast.error("Cover upload failed");
      } finally {
        setUploadingCover(false);
        if (coverInputRef.current) {
          coverInputRef.current.value = "";
        }
      }
    },
    [id, refetch],
  );

  const handleRemoveCover = useCallback(async () => {
    try {
      await api(`/api/admin/system-playlists/${id}`, "PUT", { cover_data_url: null });
      toast.success("Cover removed");
      void refetch();
    } catch {
      toast.error("Failed to remove cover");
    }
  }, [id, refetch]);

  function addRule() {
    setRules((current) => [...current, { field: "genre", op: "contains", value: "" }]);
  }

  function removeRule(index: number) {
    setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index));
  }

  function updateRule(index: number, patch: Partial<SmartRule>) {
    setRules((current) =>
      current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)),
    );
  }

  function updateRuleField(index: number, field: string) {
    const nextOp = getOpsForField(field)[0]?.value ?? "eq";
    updateRule(index, { field, op: nextOp, value: "" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!playlist) {
    return <div className="py-12 text-center text-muted-foreground">Playlist not found</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-col gap-5 md:flex-row md:items-start">
            <div className="space-y-3">
              <Button variant="ghost" size="sm" onClick={() => navigate("/playlists")} className="w-fit">
                <ArrowLeft size={14} className="mr-1" /> Back to playlists
              </Button>

              <PlaylistArtwork
                name={playlist.name}
                coverDataUrl={playlist.cover_data_url}
                tracks={playlist.artwork_tracks}
                className="h-28 w-28 rounded-md border border-white/10 bg-white/[0.03]"
                crateMarkClassName="right-3 top-3 [&_img]:h-4.5 [&_img]:w-4.5"
              />
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <CrateChip active={isSmart} className="text-[11px]">
                  {isSmart ? "smart" : "static"}
                </CrateChip>
                <CrateChip className="text-[11px]">{isCurated ? "curated" : "internal"}</CrateChip>
                <CrateChip className="text-[11px]">{isActive ? "active" : "inactive"}</CrateChip>
                {isSmart ? (
                  <CrateChip active={autoRefresh} className="text-[11px]">
                    auto-refresh
                  </CrateChip>
                ) : null}
                <StatusChip status={playlist.generation_status} />
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight">{name || playlist.name}</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {description || "No editorial description yet. Add one so the playlist reads like a first-class surface in listen."}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <CrateChip className="text-[11px]">{playlist.track_count} tracks</CrateChip>
                <CrateChip className="text-[11px]">{formatMinutes(playlist.total_duration)}</CrateChip>
                <CrateChip className="text-[11px]">
                  {playlist.follower_count} follower{playlist.follower_count === 1 ? "" : "s"}
                </CrateChip>
                {category ? <CrateChip className="text-[11px]">{category}</CrateChip> : null}
                {featuredRank != null ? <CrateChip className="text-[11px]">Rank {featuredRank}</CrateChip> : null}
                {playlist.last_generated_at ? (
                  <CrateChip className="text-[11px]">Generated {timeAgo(playlist.last_generated_at)}</CrateChip>
                ) : null}
              </div>

              {playlist.generation_error ? (
                <div className="rounded-md border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {playlist.generation_error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDuplicate}>
              <Copy size={14} className="mr-1" /> Duplicate
            </Button>
            {isSmart ? (
              <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
                {previewing ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Play size={14} className="mr-1" />
                )}
                Preview
              </Button>
            ) : null}
            {isSmart ? (
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="mr-1" />
                )}
                {smartRulesChanged ? "Save + generate" : "Generate"}
              </Button>
            ) : null}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
              Save changes
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Editorial</CardTitle>
              <p className="text-sm text-muted-foreground">
                Core metadata and visibility settings for how this playlist behaves across the product.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_160px]">
                <Field label="Name">
                  <Input value={name} onChange={(event) => setName(event.target.value)} />
                </Field>
                <Field label="Category">
                  <AdminSelect
                    value={category}
                    onChange={setCategory}
                    options={CATEGORY_OPTIONS}
                    placeholder="None"
                    triggerClassName="w-full max-w-none"
                  />
                </Field>
                <Field label="Featured rank">
                  <Input
                    type="number"
                    value={featuredRank ?? ""}
                    onChange={(event) =>
                      setFeaturedRank(event.target.value ? Number(event.target.value) : null)
                    }
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <Field label="Description">
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  placeholder="Editorial description shown in listen"
                />
              </Field>

              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <TogglePill label="Active" active={isActive} onClick={() => setIsActive((value) => !value)} />
                <TogglePill
                  label="Curated in listen"
                  active={isCurated}
                  onClick={() => setIsCurated((value) => !value)}
                />
                {isSmart ? (
                  <TogglePill
                    label="Auto-refresh daily"
                    active={autoRefresh}
                    onClick={() => setAutoRefresh((value) => !value)}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImagePlus size={16} /> Cover
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Upload a manual cover when the playlist needs a strong editorial identity. Remove it to fall back to the collage.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5 md:flex-row md:items-start">
                <PlaylistArtwork
                  name={playlist.name}
                  coverDataUrl={playlist.cover_data_url}
                  tracks={playlist.artwork_tracks}
                  className="h-28 w-28 shrink-0 rounded-md border border-white/10 bg-white/[0.03]"
                  crateMarkClassName="right-3 top-3 [&_img]:h-4.5 [&_img]:w-4.5"
                />

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <CrateChip className="text-[11px]">
                      {playlist.cover_data_url ? "Manual cover active" : "Using auto-collage"}
                    </CrateChip>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Covers help playlists feel editorially finished. Use a manual asset when this collection has a strong identity or featured placement.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCoverUpload}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                    >
                      {uploadingCover ? (
                        <Loader2 size={14} className="mr-1 animate-spin" />
                      ) : (
                        <Upload size={14} className="mr-1" />
                      )}
                      {playlist.cover_data_url ? "Replace cover" : "Upload cover"}
                    </Button>
                    {playlist.cover_data_url ? (
                      <Button variant="outline" size="sm" onClick={handleRemoveCover}>
                        <Trash2 size={14} className="mr-1" /> Remove cover
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {isSmart ? (
            <Card className="border-white/10 bg-card">
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles size={16} /> Smart rules
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Keep the builder dense, but readable: editorial intent first, then execution details and preview.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[180px_120px_180px]">
                  <Field label="Match">
                    <AdminSelect
                      value={match}
                      onChange={(value) => setMatch(value as "all" | "any")}
                      options={[
                        { value: "all", label: "All rules" },
                        { value: "any", label: "Any rule" },
                      ]}
                      allowClear={false}
                      placeholder="Match"
                      triggerClassName="w-full max-w-none"
                    />
                  </Field>

                  <Field label="Limit">
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={limit}
                      onChange={(event) => setLimit(Number(event.target.value) || 50)}
                    />
                  </Field>

                  <Field label="Sort">
                    <AdminSelect
                      value={sort}
                      onChange={setSort}
                      options={SORT_OPTIONS}
                      allowClear={false}
                      placeholder="Sort"
                      triggerClassName="w-full max-w-none"
                    />
                  </Field>
                </div>

                <div className="space-y-3">
                  {rules.map((rule, index) => {
                    const dropdownConfig = DROPDOWN_FIELDS[rule.field];
                    const dropdownOptions = dropdownConfig && filterOptions
                      ? filterOptions[dropdownConfig.optionsKey].map((value) => ({ value, label: value }))
                      : [];
                    const ops = getOpsForField(rule.field);

                    return (
                      <div key={`${rule.field}-${index}`} className="rounded-md border border-white/10 bg-black/10 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <CrateChip className="text-[11px]">Rule {index + 1}</CrateChip>
                          <ActionIconButton
                            variant="row"
                            tone="danger"
                            className="h-8 w-8"
                            onClick={() => removeRule(index)}
                          >
                            <X size={14} />
                          </ActionIconButton>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-[180px_160px_minmax(0,1fr)]">
                          <Field label="Field">
                            <AdminSelect
                              value={rule.field}
                              onChange={(value) => updateRuleField(index, value)}
                              options={RULE_FIELDS.map((field) => ({ value: field.value, label: field.label }))}
                              allowClear={false}
                              placeholder="Field"
                              triggerClassName="w-full max-w-none"
                            />
                          </Field>

                          <Field label="Operator">
                            <AdminSelect
                              value={rule.op}
                              onChange={(value) => updateRule(index, { op: value, value: "" })}
                              options={ops}
                              allowClear={false}
                              placeholder="Operator"
                              triggerClassName="w-full max-w-none"
                            />
                          </Field>

                          <Field label="Value">
                            {rule.op === "between" ? (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Input
                                  type="number"
                                  value={Array.isArray(rule.value) ? String(rule.value[0] ?? "") : ""}
                                  placeholder="Minimum"
                                  onChange={(event) =>
                                    updateRule(index, {
                                      value: [
                                        Number(event.target.value),
                                        Array.isArray(rule.value) ? Number(rule.value[1] ?? 0) : 0,
                                      ],
                                    })
                                  }
                                />
                                <Input
                                  type="number"
                                  value={Array.isArray(rule.value) ? String(rule.value[1] ?? "") : ""}
                                  placeholder="Maximum"
                                  onChange={(event) =>
                                    updateRule(index, {
                                      value: [
                                        Array.isArray(rule.value) ? Number(rule.value[0] ?? 0) : 0,
                                        Number(event.target.value),
                                      ],
                                    })
                                  }
                                />
                              </div>
                            ) : dropdownConfig ? (
                              <AdminSelect
                                value={String(rule.value ?? "")}
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
                                value={String(rule.value ?? "")}
                                placeholder="Value"
                                onChange={(event) =>
                                  updateRule(index, {
                                    value: getFieldType(rule.field) === "number"
                                      ? Number(event.target.value)
                                      : event.target.value,
                                  })
                                }
                              />
                            )}
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Use preview to sanity-check the shape of the result before saving or generating again.
                  </p>
                  <Button variant="outline" size="sm" onClick={addRule}>
                    <Plus size={14} className="mr-1" /> Add rule
                  </Button>
                </div>

                {preview ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <CrateChip active className="text-[11px]">
                        {preview.total_matching} matching tracks
                      </CrateChip>
                      <CrateChip className="text-[11px]">
                        {formatMinutes(preview.duration_total_sec)}
                      </CrateChip>
                      {preview.avg_year ? (
                        <CrateChip className="text-[11px]">Avg year {preview.avg_year}</CrateChip>
                      ) : null}
                      {preview.year_range ? (
                        <CrateChip className="text-[11px]">
                          {preview.year_range[0]}-{preview.year_range[1]}
                        </CrateChip>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 pt-4">
                      <p className="max-w-2xl text-sm text-muted-foreground">
                        Preview is only a simulation. It does not replace the playlist tracks until you generate the playlist with these rules.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {smartRulesChanged ? (
                          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving}>
                            {saving ? (
                              <Loader2 size={14} className="mr-1 animate-spin" />
                            ) : (
                              <Save size={14} className="mr-1" />
                            )}
                            Save rules
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={handleGenerate} disabled={generating}>
                          {generating ? (
                            <Loader2 size={14} className="mr-1 animate-spin" />
                          ) : (
                            <RefreshCw size={14} className="mr-1" />
                          )}
                          {smartRulesChanged ? "Apply preview to playlist" : "Generate playlist"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <DistributionBlock
                        label="Top genres"
                        items={Object.entries(preview.genre_distribution).slice(0, 10)}
                      />
                      <DistributionBlock
                        label="Top artists"
                        items={Object.entries(preview.artist_distribution).slice(0, 8)}
                      />
                    </div>

                    {preview.tracks.length > 0 ? (
                      <div className="mt-4 border-t border-primary/10 pt-4">
                        <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          Matching track sample
                        </div>
                        <div className="space-y-1.5">
                          {preview.tracks.slice(0, 8).map((track, index) => (
                            <div
                              key={`${track.artist ?? "artist"}-${track.title ?? "track"}-${index}`}
                              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/[0.03]"
                            >
                              <span className="w-6 text-right text-xs text-muted-foreground">{index + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                  {track.title || "Untitled"}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {[track.artist, track.album].filter(Boolean).join(" — ")}
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                {track.format ? (
                                  <CrateChip className="text-[10px]">{track.format}</CrateChip>
                                ) : null}
                                {track.year ? (
                                  <CrateChip className="text-[10px]">{track.year}</CrateChip>
                                ) : null}
                                {track.duration != null ? (
                                  <CrateChip className="text-[10px]">
                                    {formatTrackDuration(track.duration)}
                                  </CrateChip>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListMusic size={16} /> Tracks
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Current content snapshot for this playlist.
              </p>
            </CardHeader>
            <CardContent>
              {playlist.tracks?.length > 0 ? (
                <div className="space-y-1.5">
                  {playlist.tracks.map((track, index) => (
                    <div
                      key={track.id ?? index}
                      className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="w-6 text-right text-xs text-muted-foreground">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{track.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {track.artist} — {track.album}
                        </div>
                      </div>
                      {track.duration != null ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {formatTrackDuration(track.duration)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  {isSmart
                    ? "No generated tracks yet. Run a generation once the rule set is ready."
                    : "No tracks in this playlist yet."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <MetricTile label="Tracks" value={playlist.track_count} />
              <MetricTile label="Duration" value={formatMinutes(playlist.total_duration || 0)} />
              <MetricTile label="Followers" value={playlist.follower_count} />
              <MetricTile
                label="Last generated"
                value={playlist.last_generated_at ? timeAgo(playlist.last_generated_at) : "Never"}
              />
            </CardContent>
          </Card>

          {history && history.length > 0 ? (
            <Card className="border-white/10 bg-card">
              <CardHeader className="space-y-1">
                <CardTitle className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
                  Generation history
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-white/10 bg-black/10 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <StatusChip status={entry.status} />
                        <span className="text-sm">{timeAgo(entry.started_at)}</span>
                      </div>
                      {entry.track_count != null ? (
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {entry.track_count} tracks
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {entry.triggered_by}
                      {entry.duration_sec != null ? ` · ${Math.round(entry.duration_sec)}s` : ""}
                    </div>
                    {entry.error ? (
                      <div className="mt-2 text-xs text-red-200">{entry.error}</div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
