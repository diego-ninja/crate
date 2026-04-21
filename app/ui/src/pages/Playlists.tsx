import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActionIconButton } from "@/components/ui/ActionIconButton";
import { CrateChip, CratePill } from "@/components/ui/CrateBadge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDuration } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ListMusic,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface PlaylistTrack {
  id: number;
  track_path: string;
  track_id?: number;
  title: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album: string;
  album_id?: number;
  album_slug?: string;
  duration: number;
  position: number;
}

interface SmartRules {
  match: "all" | "any";
  rules: { field: string; op: string; value: unknown }[];
  limit: number;
  sort: string;
}

interface SystemPlaylist {
  id: number;
  name: string;
  description: string;
  cover_data_url?: string | null;
  artwork_tracks?: Array<{ artist: string; album: string; album_id?: number; album_slug?: string }>;
  is_smart: boolean;
  smart_rules: SmartRules | null;
  generation_mode: "static" | "smart";
  scope: "system" | "user";
  is_curated: boolean;
  is_active: boolean;
  featured_rank?: number | null;
  category?: string | null;
  follower_count: number;
  track_count: number;
  total_duration: number;
  generation_status?: string;
  last_generated_at?: string | null;
  created_at: string;
  updated_at: string;
  tracks?: PlaylistTrack[];
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  scales: string[];
  artists: string[];
  year_range: [string, string];
  bpm_range: [number, number];
}

interface SmartRule {
  field: string;
  op: string;
  values: string[];
  rangeMin: string;
  rangeMax: string;
}

const SMART_FIELDS = [
  { value: "genre", label: "Genre" },
  { value: "popularity", label: "Popularity" },
  { value: "bpm", label: "BPM" },
  { value: "energy", label: "Energy" },
  { value: "year", label: "Year" },
  { value: "audio_key", label: "Key" },
  { value: "danceability", label: "Danceability" },
  { value: "valence", label: "Valence" },
  { value: "artist", label: "Artist" },
  { value: "format", label: "Format" },
] as const;

type FilterMode = "all" | "curated" | "smart" | "inactive";

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Playlists() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<SystemPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedData, setExpandedData] = useState<SystemPlaylist | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemPlaylist | null>(null);
  const [showCreateStatic, setShowCreateStatic] = useState(false);
  const [showCreateSmart, setShowCreateSmart] = useState(false);

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

  const filteredPlaylists = useMemo(() => {
    return playlists.filter((playlist) => {
      if (filter === "curated") return playlist.is_curated;
      if (filter === "smart") return playlist.generation_mode === "smart";
      if (filter === "inactive") return !playlist.is_active;
      return true;
    });
  }, [filter, playlists]);

  async function loadPlaylist(id: number) {
    if (expanded === id) {
      setExpanded(null);
      setExpandedData(null);
      return;
    }
    try {
      const data = await api<SystemPlaylist>(`/api/admin/system-playlists/${id}`);
      setExpandedData(data);
      setExpanded(id);
    } catch {
      toast.error("Failed to load system playlist");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/admin/system-playlists/${deleteTarget.id}`, "DELETE");
      toast.success(`Deleted "${deleteTarget.name}"`);
      if (expanded === deleteTarget.id) {
        setExpanded(null);
        setExpandedData(null);
      }
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
      if (expanded === playlist.id) {
        void loadPlaylist(playlist.id);
      }
      void fetchPlaylists();
    } catch {
      toast.error("Failed to update status");
    }
  }

  async function regenerateSmart(playlistId: number) {
    try {
      const result = await api<{ generated_track_count: number }>(
        `/api/admin/system-playlists/${playlistId}/generate`,
        "POST",
      );
      toast.success(`Regenerated: ${result.generated_track_count} tracks`);
      if (expanded === playlistId) {
        void loadPlaylist(playlistId);
      }
      void fetchPlaylists();
    } catch {
      toast.error("Failed to regenerate smart system playlist");
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ListMusic size={24} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold">System Playlists</h1>
            <p className="text-sm text-muted-foreground">
              Global playlists for `listen`: static, smart, and curated.
            </p>
          </div>
          <CratePill active>{filteredPlaylists.length} visible</CratePill>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              setShowCreateStatic(true);
              setShowCreateSmart(false);
            }}
          >
            <Plus size={14} className="mr-1" /> New Static
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowCreateSmart(true);
              setShowCreateStatic(false);
            }}
          >
            <Sparkles size={14} className="mr-1" /> New Smart
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { key: "all", label: "All" },
          { key: "curated", label: "Curated" },
          { key: "smart", label: "Smart" },
          { key: "inactive", label: "Inactive" },
        ].map((item) => (
          <Button
            key={item.key}
            size="sm"
            variant={filter === item.key ? "default" : "outline"}
            onClick={() => setFilter(item.key as FilterMode)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {showCreateStatic && (
        <CreateSystemPlaylistForm
          onCreated={() => {
            setShowCreateStatic(false);
            void fetchPlaylists();
          }}
          onCancel={() => setShowCreateStatic(false)}
        />
      )}

      {showCreateSmart && (
        <SmartSystemPlaylistForm
          onCreated={() => {
            setShowCreateSmart(false);
            void fetchPlaylists();
          }}
          onCancel={() => setShowCreateSmart(false)}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      ) : filteredPlaylists.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          No system playlists for this filter yet.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPlaylists.map((playlist) => (
            <Card key={playlist.id} className="overflow-hidden bg-card">
              <div
                className="flex cursor-pointer items-center gap-4 px-4 py-4 transition-colors hover:bg-white/[0.03]"
                onClick={() => navigate(`/playlists/${playlist.id}`)}
              >
                <div className="h-11 w-11 flex-shrink-0 rounded-md border border-white/10 bg-white/[0.03] overflow-hidden flex items-center justify-center">
                  {playlist.cover_data_url ? (
                    <img src={playlist.cover_data_url} alt="" className="h-full w-full object-cover" />
                  ) : playlist.generation_mode === "smart" ? (
                    <Sparkles size={18} className="text-primary" />
                  ) : (
                    <ListMusic size={18} className="text-primary" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-semibold">{playlist.name}</div>
                    <CrateChip>system</CrateChip>
                    {playlist.is_curated && (
                      <CrateChip>curated</CrateChip>
                    )}
                    {playlist.generation_mode === "smart" && (
                      <CrateChip active>smart</CrateChip>
                    )}
                    {!playlist.is_active && (
                      <CrateChip>inactive</CrateChip>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{playlist.track_count} tracks</span>
                    <span>·</span>
                    <span>{fmtDuration(playlist.total_duration)}</span>
                    <span>·</span>
                    <span>{playlist.follower_count} follower{playlist.follower_count === 1 ? "" : "s"}</span>
                    {playlist.category && <><span>·</span><span>{playlist.category}</span></>}
                    {playlist.generation_status === "running" && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary text-[9px] px-1.5 py-0">generating</Badge>}
                    {playlist.generation_status === "failed" && <Badge variant="outline" className="border-red-400/30 bg-red-400/10 text-red-300 text-[9px] px-1.5 py-0">failed</Badge>}
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  <ActionIconButton
                    variant="row"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleActive(playlist);
                    }}
                  >
                    {playlist.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                  </ActionIconButton>
                  <ActionIconButton
                    variant="row"
                    tone="danger"
                    className="h-8 w-8"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(playlist);
                    }}
                  >
                    <Trash2 size={14} />
                  </ActionIconButton>
                  {expanded === playlist.id ? (
                    <ChevronUp size={14} className="text-muted-foreground" />
                  ) : (
                    <ChevronDown size={14} className="text-muted-foreground" />
                  )}
                </div>
              </div>

              {expanded === playlist.id && expandedData && (
                <div className="border-t border-border">
                  <SystemPlaylistEditor
                    playlist={expandedData}
                    onUpdated={async () => {
                      await loadPlaylist(expandedData.id);
                      await fetchPlaylists();
                    }}
                    onRegenerate={
                      expandedData.generation_mode === "smart"
                        ? async () => regenerateSmart(expandedData.id)
                        : undefined
                    }
                  />

                  <div className="border-t border-border">
                    {(expandedData.tracks ?? []).length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        {expandedData.generation_mode === "static"
                          ? "Static system playlist created. Track curation UI can be added next."
                          : "No tracks generated yet."}
                      </div>
                    ) : (
                      <div className="max-h-[360px] overflow-y-auto">
                        {(expandedData.tracks ?? []).map((track) => (
                          <div
                            key={track.id}
                            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]"
                          >
                            <span className="w-6 text-right text-xs text-muted-foreground">
                              {track.position}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm">{track.title}</div>
                              <div className="truncate text-xs text-muted-foreground">
                                {track.artist} — {track.album}
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDuration(Math.floor(track.duration))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete System Playlist"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function CreateSystemPlaylistForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/admin/system-playlists", "POST", {
        name: name.trim(),
        description,
        category,
        featured_rank: featuredRank.trim() ? Number(featuredRank) : null,
        generation_mode: "static",
        is_curated: true,
      });
      toast.success("System playlist created");
      onCreated();
    } catch {
      toast.error("Failed to create system playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="mb-3 flex items-center gap-3">
        <Plus size={16} className="text-primary" />
        <span className="text-sm font-semibold">New Static System Playlist</span>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          className="md:col-span-1"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="md:col-span-2"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editorial">Editorial</SelectItem>
            <SelectItem value="mood">Mood</SelectItem>
            <SelectItem value="genre">Genre</SelectItem>
            <SelectItem value="fresh">Fresh</SelectItem>
            <SelectItem value="scene">Scene</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Input
          value={featuredRank}
          onChange={(e) => setFeaturedRank(e.target.value)}
          placeholder="Featured rank (optional)"
          className="w-48"
        />
        <div className="flex-1" />
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving || !name.trim()}>
          {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
          Create
        </Button>
      </div>
    </Card>
  );
}

function SystemPlaylistEditor({
  playlist,
  onUpdated,
  onRegenerate,
}: {
  playlist: SystemPlaylist;
  onUpdated: () => Promise<void>;
  onRegenerate?: () => Promise<void>;
}) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description || "");
  const [category, setCategory] = useState(playlist.category || "editorial");
  const [featuredRank, setFeaturedRank] = useState(
    playlist.featured_rank != null ? String(playlist.featured_rank) : "",
  );
  const [isCurated, setIsCurated] = useState(playlist.is_curated);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setName(playlist.name);
    setDescription(playlist.description || "");
    setCategory(playlist.category || "editorial");
    setFeaturedRank(playlist.featured_rank != null ? String(playlist.featured_rank) : "");
    setIsCurated(playlist.is_curated);
  }, [playlist]);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/admin/system-playlists/${playlist.id}`, "PUT", {
        name,
        description,
        category,
        featured_rank: featuredRank.trim() ? Number(featuredRank) : null,
        is_curated: isCurated,
      });
      toast.success("System playlist updated");
      await onUpdated();
    } catch {
      toast.error("Failed to update system playlist");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (!onRegenerate) return;
    setRegenerating(true);
    try {
      await onRegenerate();
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="md:col-span-2"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editorial">Editorial</SelectItem>
            <SelectItem value="mood">Mood</SelectItem>
            <SelectItem value="genre">Genre</SelectItem>
            <SelectItem value="fresh">Fresh</SelectItem>
            <SelectItem value="scene">Scene</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Input
          value={featuredRank}
          onChange={(e) => setFeaturedRank(e.target.value)}
          placeholder="Featured rank"
          className="w-40"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={isCurated}
            onChange={(e) => setIsCurated(e.target.checked)}
          />
          Curated / public in listen
        </label>
        <div className="flex-1" />
        {playlist.generation_mode === "smart" && (
          <Button variant="outline" onClick={regenerate} disabled={regenerating}>
            {regenerating ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            Regenerate
          </Button>
        )}
        <Button onClick={save} disabled={saving || !name.trim()}>
          {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

function SmartSystemPlaylistForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [rules, setRules] = useState<SmartRule[]>([
    { field: "genre", op: "contains", values: [], rangeMin: "", rangeMax: "" },
  ]);
  const [limit, setLimit] = useState(50);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sort, setSort] = useState<string>("random");
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<FilterOptions | null>(null);

  useEffect(() => {
    api<FilterOptions>("/api/playlists/filter-options").then(setOptions).catch(() => {});
  }, []);

  function addRule() {
    setRules([
      ...rules,
      { field: "genre", op: "contains", values: [], rangeMin: "", rangeMax: "" },
    ]);
  }

  function removeRule(index: number) {
    setRules(rules.filter((_, currentIndex) => currentIndex !== index));
  }

  function getOpsForField(field: string): { value: string; label: string }[] {
    if (field === "bpm" || field === "year" || field === "popularity") {
      return [{ value: "between", label: "between" }];
    }
    if (field === "energy" || field === "danceability" || field === "valence") {
      return [
        { value: "gte", label: ">=" },
        { value: "lte", label: "<=" },
      ];
    }
    if (field === "genre") return [{ value: "contains", label: "contains" }];
    return [{ value: "eq", label: "equals" }];
  }

  function updateField(index: number, field: string) {
    const updated = [...rules];
    const ops = getOpsForField(field);
    updated[index] = {
      field,
      op: ops[0]?.value ?? "eq",
      values: [],
      rangeMin: "",
      rangeMax: "",
    };
    setRules(updated);
  }

  function toggleValue(index: number, value: string) {
    const updated = [...rules];
    const rule = updated[index];
    if (!rule) return;
    rule.values = rule.values.includes(value)
      ? rule.values.filter((item) => item !== value)
      : [...rule.values, value];
    setRules(updated);
  }

  function setRange(index: number, key: "rangeMin" | "rangeMax", value: string) {
    const updated = [...rules];
    if (!updated[index]) return;
    updated[index][key] = value;
    setRules(updated);
  }

  function getOptionsForField(field: string): string[] {
    if (!options) return [];
    switch (field) {
      case "genre":
        return options.genres;
      case "format":
        return options.formats;
      case "audio_key":
        return options.keys;
      case "artist":
        return options.artists;
      default:
        return [];
    }
  }

  function isRangeField(field: string): boolean {
    return ["bpm", "year", "energy", "danceability", "valence", "popularity"].includes(field);
  }

  function isMultiSelectField(field: string): boolean {
    return ["genre", "format", "audio_key", "artist"].includes(field);
  }

  function ruleHasValue(rule: SmartRule): boolean {
    if (isRangeField(rule.field)) return rule.rangeMin !== "" || rule.rangeMax !== "";
    return rule.values.length > 0;
  }

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const smartRules = {
        match,
        rules: rules.filter(ruleHasValue).map((rule) => {
          if (isRangeField(rule.field)) {
            const min = parseFloat(rule.rangeMin) || 0;
            const max = parseFloat(rule.rangeMax) || 9999;
            return { field: rule.field, op: "between", value: [min, max] };
          }
          if (rule.values.length === 1) {
            return { field: rule.field, op: rule.op, value: rule.values[0] };
          }
          return { field: rule.field, op: rule.op, value: rule.values.join("|") };
        }),
        limit,
        sort,
      };
      await api("/api/admin/system-playlists", "POST", {
        name: name.trim(),
        description,
        category,
        featured_rank: featuredRank.trim() ? Number(featuredRank) : null,
        generation_mode: "smart",
        is_curated: true,
        smart_rules: smartRules,
      });
      toast.success("Smart system playlist created");
      onCreated();
    } catch {
      toast.error("Failed to create smart system playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="mb-4 flex items-center gap-3">
        <Sparkles size={16} className="text-primary" />
        <span className="text-sm font-semibold">New Smart System Playlist</span>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          className="md:col-span-2"
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="editorial">Editorial</SelectItem>
            <SelectItem value="mood">Mood</SelectItem>
            <SelectItem value="genre">Genre</SelectItem>
            <SelectItem value="fresh">Fresh</SelectItem>
            <SelectItem value="scene">Scene</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={featuredRank}
          onChange={(e) => setFeaturedRank(e.target.value)}
          placeholder="Featured rank"
        />
      </div>

      <div className="space-y-4">
        <div className="flex gap-3">
          <Select value={match} onValueChange={(value) => setMatch(value as "all" | "any")}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Match all</SelectItem>
              <SelectItem value="any">Match any</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 50)}
            min={1}
            max={500}
            className="w-20"
            placeholder="Limit"
          />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="random">Random</SelectItem>
              <SelectItem value="popularity">Most Popular</SelectItem>
              <SelectItem value="energy">Highest Energy</SelectItem>
              <SelectItem value="bpm">By BPM</SelectItem>
              <SelectItem value="title">Alphabetical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rules.map((rule, index) => (
          <div key={index} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <Select value={rule.field} onValueChange={(value) => updateField(index, value)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SMART_FIELDS.map((field) => (
                    <SelectItem key={field.value} value={field.value}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isRangeField(rule.field) && (
                <>
                  <span className="text-xs text-muted-foreground">from</span>
                  <Input
                    type="number"
                    value={rule.rangeMin}
                    onChange={(e) => setRange(index, "rangeMin", e.target.value)}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    value={rule.rangeMax}
                    onChange={(e) => setRange(index, "rangeMax", e.target.value)}
                    className="w-24"
                  />
                </>
              )}

              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRule(index)}>
                <Trash2 size={14} />
              </Button>
            </div>

            {isMultiSelectField(rule.field) && (
              <div>
                {rule.values.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {rule.values.map((value) => (
                      <Badge key={value} variant="secondary" className="gap-1 pl-2 pr-1 py-0.5 text-xs">
                        {value}
                        <button onClick={() => toggleValue(index, value)} className="ml-0.5 hover:text-destructive">
                          ×
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                  {getOptionsForField(rule.field)
                    .filter((option) => !rule.values.includes(option))
                    .map((option) => (
                      <button
                        key={option}
                        onClick={() => toggleValue(index, option)}
                        className="rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        {option}
                      </button>
                    ))}
                  {getOptionsForField(rule.field).length === 0 && (
                    <span className="text-xs text-muted-foreground">No options available</span>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRule}>
            <Plus size={12} className="mr-1" /> Add Rule
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !name.trim() || rules.every((rule) => !ruleHasValue(rule))}>
            {saving ? (
              <Loader2 size={14} className="mr-1 animate-spin" />
            ) : (
              <Sparkles size={14} className="mr-1" />
            )}
            Create
          </Button>
        </div>
      </div>
    </Card>
  );
}
