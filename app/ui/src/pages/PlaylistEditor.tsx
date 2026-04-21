import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, Copy, ImagePlus, ListMusic, Loader2, Play, Plus, RefreshCw,
  Save, Sparkles, Trash2, Upload, X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────

interface Playlist {
  id: number;
  name: string;
  description: string | null;
  generation_mode: string;
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
  tracks: Track[];
}

interface SmartRules {
  match: string;
  rules: SmartRule[];
  limit: number;
  sort: string;
  deduplicate_artist?: boolean;
  max_per_artist?: number;
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

interface PreviewResult {
  total_matching: number;
  tracks: Record<string, unknown>[];
  genre_distribution: Record<string, number>;
  artist_distribution: Record<string, number>;
  format_distribution: Record<string, number>;
  duration_total_sec: number;
  avg_year: number | null;
  year_range: number[] | null;
}

// ── Constants ────────────────────────────────────────────────────

const FIELDS = [
  { value: "genre", label: "Genre", type: "text" },
  { value: "artist", label: "Artist", type: "text" },
  { value: "album", label: "Album", type: "text" },
  { value: "title", label: "Title", type: "text" },
  { value: "year", label: "Year", type: "range" },
  { value: "format", label: "Format", type: "text" },
  { value: "bpm", label: "BPM", type: "range" },
  { value: "energy", label: "Energy", type: "number" },
  { value: "danceability", label: "Danceability", type: "number" },
  { value: "valence", label: "Valence", type: "number" },
  { value: "acousticness", label: "Acousticness", type: "number" },
  { value: "popularity", label: "Popularity", type: "range" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "duration", label: "Duration", type: "range" },
];

const TEXT_OPS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
];

const NUMBER_OPS = [
  { value: "eq", label: "=" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "between", label: "between" },
];

const SORTS = [
  { value: "random", label: "Random" },
  { value: "popularity", label: "Popularity" },
  { value: "energy", label: "Energy" },
  { value: "bpm", label: "BPM" },
  { value: "title", label: "Title" },
];

const CATEGORIES = ["genre", "mood", "activity", "era", "editorial", "seasonal"];

function getOpsForField(field: string) {
  const f = FIELDS.find((x) => x.value === field);
  return !f || f.type === "text" ? TEXT_OPS : NUMBER_OPS;
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  artists: string[];
}

// Fields that should render as a searchable dropdown instead of free text
const DROPDOWN_FIELDS: Record<string, { optionsKey: keyof FilterOptions; searchPlaceholder: string }> = {
  artist: { optionsKey: "artists", searchPlaceholder: "Search artists..." },
  genre: { optionsKey: "genres", searchPlaceholder: "Search genres..." },
  format: { optionsKey: "formats", searchPlaceholder: "Search formats..." },
  audio_key: { optionsKey: "keys", searchPlaceholder: "Search keys..." },
};

// ── Main ─────────────────────────────────────────────────────────

export function PlaylistEditor() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const id = Number(playlistId);

  const { data: playlist, loading, refetch } = useApi<Playlist>(id ? `/api/admin/system-playlists/${id}` : null);
  const { data: history, refetch: refetchHistory } = useApi<GenerationLog[]>(id ? `/api/admin/system-playlists/${id}/generation-history` : null);
  const { data: filterOptions } = useApi<FilterOptions>("/api/playlists/filter-options");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [featuredRank, setFeaturedRank] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isCurated, setIsCurated] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rules, setRules] = useState<SmartRule[]>([]);
  const [match, setMatch] = useState("all");
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
    }
  }, [playlist]);

  const isSmart = playlist?.is_smart ?? false;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name, description: description || null, category: category || null,
        featured_rank: featuredRank, is_active: isActive, is_curated: isCurated,
      };
      if (isSmart) {
        body.smart_rules = { match, rules, limit, sort };
        body.auto_refresh_enabled = autoRefresh;
      }
      await api(`/api/admin/system-playlists/${id}`, "PUT", body);
      toast.success("Playlist saved");
      refetch();
      refetchHistory();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }, [name, description, category, featuredRank, isActive, isCurated, autoRefresh, match, rules, limit, sort, id, isSmart, refetch, refetchHistory]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await api(`/api/admin/system-playlists/${id}/generate`, "POST");
      toast.success("Generation enqueued");
      refetch();
    } catch { toast.error("Failed to enqueue generation"); }
    finally { setGenerating(false); }
  }, [id, refetch]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      await api(`/api/admin/system-playlists/${id}`, "PUT", { smart_rules: { match, rules, limit, sort } });
      const result = await api<PreviewResult>(`/api/admin/system-playlists/${id}/preview`, "POST");
      setPreview(result);
    } catch { toast.error("Preview failed"); }
    finally { setPreviewing(false); }
  }, [id, match, rules, limit, sort]);

  const handleDuplicate = useCallback(async () => {
    try {
      const result = await api<{ id: number }>(`/api/admin/system-playlists/${id}/duplicate`, "POST");
      toast.success("Playlist duplicated");
      navigate(`/playlists/${result.id}`);
    } catch { toast.error("Failed to duplicate"); }
  }, [id, navigate]);

  const handleCoverUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const reader = new FileReader();
      const b64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      await api(`/api/admin/system-playlists/${id}`, "PUT", { cover_data_url: b64 });
      toast.success("Cover uploading...");
      refetch();
    } catch { toast.error("Cover upload failed"); }
    finally { setUploadingCover(false); if (coverInputRef.current) coverInputRef.current.value = ""; }
  }, [id, refetch]);

  const handleRemoveCover = useCallback(async () => {
    try {
      await api(`/api/admin/system-playlists/${id}`, "PUT", { cover_data_url: null });
      toast.success("Cover removed");
      refetch();
    } catch { toast.error("Failed to remove cover"); }
  }, [id, refetch]);

  const addRule = () => setRules([...rules, { field: "genre", op: "contains", value: "" }]);
  const removeRule = (i: number) => setRules(rules.filter((_, idx) => idx !== i));
  const updateRule = (i: number, key: string, value: unknown) =>
    setRules(rules.map((r, idx) => idx === i ? { ...r, [key]: value } : r));

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!playlist) return <div className="text-center py-12 text-muted-foreground">Playlist not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/playlists")}>
            <ArrowLeft size={14} className="mr-1" /> Playlists
          </Button>
          <h1 className="text-xl font-bold">{playlist.name}</h1>
          <Badge variant="outline">{isSmart ? "smart" : "static"}</Badge>
          {playlist.generation_status === "running" && <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Generating...</Badge>}
          {playlist.generation_status === "queued" && <Badge variant="outline" className="border-amber-400/30 bg-amber-400/10 text-amber-300">Queued</Badge>}
          {playlist.generation_status === "failed" && <Badge variant="outline" className="border-red-400/30 bg-red-400/10 text-red-300">Failed</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDuplicate}><Copy size={14} className="mr-1" /> Duplicate</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />} Save
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Editorial */}
          <Card className="bg-card">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2">Editorial</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <AdminSelect value={category} onChange={setCategory}
                    options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                    placeholder="None" triggerClassName="w-full max-w-none" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                  className="w-full rounded-md border border-white/10 bg-black/25 px-4 py-2 text-sm text-foreground placeholder:text-white/40 focus-visible:border-primary/35 outline-none" />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-primary" /> Active</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isCurated} onChange={(e) => setIsCurated(e.target.checked)} className="accent-primary" /> Curated</label>
                {isSmart && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="accent-primary" /> Auto-refresh (daily)</label>}
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-muted-foreground">Rank</label>
                  <Input type="number" value={featuredRank ?? ""} onChange={(e) => setFeaturedRank(e.target.value ? Number(e.target.value) : null)} className="h-9 w-20" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cover */}
          <Card className="bg-card">
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ImagePlus size={14} /> Cover</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className="h-24 w-24 flex-shrink-0 rounded-md border border-white/10 bg-white/[0.03] overflow-hidden flex items-center justify-center">
                  {playlist.cover_data_url ? <img src={playlist.cover_data_url} alt="Cover" className="h-full w-full object-cover" /> : <ListMusic size={24} className="text-white/20" />}
                </div>
                <div className="space-y-2">
                  <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
                  <Button variant="outline" size="sm" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}>
                    {uploadingCover ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Upload size={14} className="mr-1" />}
                    {playlist.cover_data_url ? "Replace" : "Upload"}
                  </Button>
                  {playlist.cover_data_url && <Button variant="outline" size="sm" onClick={handleRemoveCover}><Trash2 size={14} className="mr-1" /> Remove</Button>}
                  <p className="text-[11px] text-muted-foreground">{playlist.cover_data_url ? "Manual cover active." : "No manual cover. Using auto-collage."}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Smart Rules */}
          {isSmart && (
            <Card className="bg-card">
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-sm flex items-center gap-2"><Sparkles size={14} /> Smart Rules</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewing}>
                      {previewing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Play size={14} className="mr-1" />} Preview
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                      {generating ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />} Generate
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <AdminSelect value={match} onChange={setMatch}
                    options={[{ value: "all", label: "All rules" }, { value: "any", label: "Any rule" }]}
                    placeholder="Match" allowClear={false} />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Limit</span>
                    <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} min={1} max={500} className="h-10 w-20" />
                  </div>
                  <AdminSelect value={sort} onChange={setSort}
                    options={SORTS.map((s) => ({ value: s.value, label: s.label }))}
                    placeholder="Sort" allowClear={false} />
                </div>

                <div className="space-y-2">
                  {rules.map((rule, i) => {
                    const ops = getOpsForField(rule.field);
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-md border border-white/10 bg-black/15 p-2.5">
                        <AdminSelect value={rule.field} onChange={(v) => updateRule(i, "field", v)}
                          options={FIELDS.map((f) => ({ value: f.value, label: f.label }))}
                          placeholder="Field" allowClear={false} triggerClassName="min-w-[120px]" />
                        <AdminSelect value={rule.op} onChange={(v) => updateRule(i, "op", v)}
                          options={ops.map((o) => ({ value: o.value, label: o.label }))}
                          placeholder="Op" allowClear={false} triggerClassName="min-w-[100px]" />
                        {rule.op === "between" ? (
                          <div className="flex items-center gap-1">
                            <Input type="number" value={Array.isArray(rule.value) ? rule.value[0] : ""} placeholder="min"
                              onChange={(e) => updateRule(i, "value", [Number(e.target.value), Array.isArray(rule.value) ? rule.value[1] : 0])}
                              className="h-10 w-20" />
                            <span className="text-xs text-muted-foreground">–</span>
                            <Input type="number" value={Array.isArray(rule.value) ? rule.value[1] : ""} placeholder="max"
                              onChange={(e) => updateRule(i, "value", [Array.isArray(rule.value) ? rule.value[0] : 0, Number(e.target.value)])}
                              className="h-10 w-20" />
                          </div>
                        ) : DROPDOWN_FIELDS[rule.field] && filterOptions ? (
                          <AdminSelect
                            value={String(rule.value ?? "")}
                            onChange={(v) => updateRule(i, "value", v)}
                            options={(filterOptions[DROPDOWN_FIELDS[rule.field]!.optionsKey] ?? []).map((v) => ({ value: v, label: v }))}
                            placeholder={`Select ${rule.field}...`}
                            searchable
                            searchPlaceholder={DROPDOWN_FIELDS[rule.field]!.searchPlaceholder}
                            allowClear={false}
                            triggerClassName="min-w-[160px] flex-1 max-w-none"
                          />
                        ) : (
                          <Input value={String(rule.value ?? "")} placeholder="value"
                            onChange={(e) => updateRule(i, "value", e.target.value)}
                            className="h-10 flex-1" />
                        )}
                        <button onClick={() => removeRule(i)} className="rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-white/5 transition-colors">
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={addRule}><Plus size={14} className="mr-1" /> Add Rule</Button>
                </div>

                {preview && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-4 space-y-3">
                    <div className="text-sm font-medium">
                      {preview.total_matching} tracks match · {Math.round(preview.duration_total_sec / 60)}m
                      {preview.avg_year ? ` · avg ${preview.avg_year}` : ""}
                      {preview.year_range ? ` (${preview.year_range[0]}–${preview.year_range[1]})` : ""}
                    </div>
                    {Object.keys(preview.genre_distribution).length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Top genres</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(preview.genre_distribution).slice(0, 10).map(([g, c]) => (
                            <Badge key={g} variant="outline" className="text-[10px]">{g} ({c})</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {Object.keys(preview.artist_distribution).length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Top artists</div>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(preview.artist_distribution).slice(0, 8).map(([a, c]) => (
                            <Badge key={a} variant="outline" className="text-[10px]">{a} ({c})</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Tracks */}
          {playlist.tracks?.length > 0 && (
            <Card className="bg-card">
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ListMusic size={14} /> Tracks ({playlist.track_count})</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-0.5 max-h-96 overflow-y-auto">
                  {playlist.tracks.map((t, i) => (
                    <div key={t.id ?? i} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-white/[0.03]">
                      <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-foreground">{t.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{t.artist} — {t.album}</div>
                      </div>
                      {t.duration != null && <span className="text-xs text-muted-foreground tabular-nums">{Math.floor(t.duration / 60)}:{String(Math.floor(t.duration % 60)).padStart(2, "0")}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card className="bg-card">
            <CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Status</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Tracks</span><span className="tabular-nums">{playlist.track_count}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span className="tabular-nums">{Math.round((playlist.total_duration || 0) / 60)}m</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Followers</span><span className="tabular-nums">{playlist.follower_count}</span></div>
              {playlist.last_generated_at && <div className="flex justify-between"><span className="text-muted-foreground">Last generated</span><span>{timeAgo(playlist.last_generated_at)}</span></div>}
              {playlist.generation_error && <div className="rounded border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-300">{playlist.generation_error}</div>}
            </CardContent>
          </Card>

          {history && history.length > 0 && (
            <Card className="bg-card">
              <CardHeader><CardTitle className="text-xs uppercase text-muted-foreground">Generation History</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-xs">
                    <div>
                      <span className={h.status === "completed" ? "text-emerald-400" : h.status === "failed" ? "text-red-400" : "text-muted-foreground"}>
                        {h.status === "completed" ? "✓" : h.status === "failed" ? "✗" : "…"}
                      </span>
                      {" "}{timeAgo(h.started_at)}
                      <span className="text-muted-foreground"> · {h.triggered_by}</span>
                    </div>
                    {h.track_count != null && <span className="tabular-nums text-muted-foreground">{h.track_count} tracks</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
