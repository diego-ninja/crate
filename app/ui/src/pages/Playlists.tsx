import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { usePlayer, type Track as PlayerTrack } from "@/contexts/PlayerContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Loader2, Trash2, ListMusic, Sparkles, Plus, Play, ExternalLink,
  ChevronDown, ChevronUp, X,
} from "lucide-react";
import { toast } from "sonner";
import { formatDuration, encPath } from "@/lib/utils";

interface PlaylistTrack {
  id: number;
  track_path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  position: number;
}

interface Playlist {
  id: number;
  name: string;
  description: string;
  is_smart: boolean;
  smart_rules: SmartRules | null;
  track_count: number;
  total_duration: number;
  created_at: string;
  updated_at: string;
  tracks?: PlaylistTrack[];
}

interface SmartRules {
  match: "all" | "any";
  rules: { field: string; op: string; value: unknown }[];
  limit: number;
  sort: string;
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
];

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function Playlists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedData, setExpandedData] = useState<Playlist | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showSmart, setShowSmart] = useState(false);
  const player = usePlayer();

  const fetchPlaylists = useCallback(async () => {
    try {
      const data = await api<Playlist[]>("/api/playlists");
      setPlaylists(Array.isArray(data) ? data : []);
    } catch {
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlaylists(); }, [fetchPlaylists]);

  async function loadPlaylist(id: number) {
    if (expanded === id) { setExpanded(null); setExpandedData(null); return; }
    try {
      const data = await api<Playlist>(`/api/playlists/${id}`);
      setExpandedData(data);
      setExpanded(id);
    } catch { toast.error("Failed to load playlist"); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/playlists/${deleteTarget.id}`, "DELETE");
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      if (expanded === deleteTarget.id) { setExpanded(null); setExpandedData(null); }
      fetchPlaylists();
    } catch { toast.error("Failed to delete"); }
  }

  async function removeTrack(playlistId: number, position: number) {
    try {
      await api(`/api/playlists/${playlistId}/tracks/${position}`, "DELETE");
      loadPlaylist(playlistId);
      fetchPlaylists();
    } catch { toast.error("Failed to remove track"); }
  }

  function playPlaylist(pl: Playlist) {
    if (!pl.tracks || pl.tracks.length === 0) return;
    const tracks: PlayerTrack[] = pl.tracks.map((t) => ({
      id: t.track_path,
      title: t.title,
      artist: t.artist,
      albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined,
    }));
    player.playAll(tracks, 0);
  }

  async function syncNavidrome(playlistId: number) {
    try {
      const { task_id } = await api<{ task_id: string }>(`/api/playlists/${playlistId}/sync-navidrome`, "POST");
      toast.success("Syncing to Navidrome...");
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string; result?: { matched?: number; unmatched?: string[] } }>(`/api/tasks/${task_id}`);
          if (task.status === "completed") {
            clearInterval(poll);
            toast.success(`Synced to Navidrome (${task.result?.matched ?? 0} tracks matched)`);
          } else if (task.status === "failed") {
            clearInterval(poll);
            toast.error("Navidrome sync failed");
          }
        } catch { /* polling */ }
      }, 2000);
      setTimeout(() => clearInterval(poll), 60000);
    } catch { toast.error("Failed to start sync"); }
  }

  async function regenerateSmart(playlistId: number) {
    try {
      const result = await api<{ track_count: number }>(`/api/playlists/${playlistId}/generate`, "POST");
      toast.success(`Regenerated: ${result.track_count} tracks`);
      loadPlaylist(playlistId);
      fetchPlaylists();
    } catch { toast.error("Failed to regenerate"); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ListMusic size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Playlists</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => { setShowCreate(true); setShowSmart(false); }}>
            <Plus size={14} className="mr-1" /> New Playlist
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setShowSmart(true); setShowCreate(false); }}>
            <Sparkles size={14} className="mr-1" /> Smart Playlist
          </Button>
        </div>
      </div>

      {/* Create normal playlist */}
      {showCreate && <CreatePlaylistForm onCreated={() => { setShowCreate(false); fetchPlaylists(); }} onCancel={() => setShowCreate(false)} />}

      {/* Create smart playlist */}
      {showSmart && <SmartPlaylistForm onCreated={() => { setShowSmart(false); fetchPlaylists(); }} onCancel={() => setShowSmart(false)} />}

      {/* Playlist list */}
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading...
        </div>
      ) : playlists.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No playlists yet. Create one!
        </div>
      ) : (
        <div className="space-y-2">
          {playlists.map((pl) => (
            <Card key={pl.id} className="bg-card overflow-hidden">
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => loadPlaylist(pl.id)}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  {pl.is_smart ? <Sparkles size={18} className="text-primary" /> : <ListMusic size={18} className="text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{pl.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {pl.track_count} tracks · {fmtDuration(pl.total_duration)}
                    {pl.is_smart && <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0">smart</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); loadPlaylist(pl.id).then(() => { const full = expandedData ?? pl; if (full.tracks) playPlaylist(full); }); }}>
                    <Play size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={(e) => { e.stopPropagation(); syncNavidrome(pl.id); }}>
                    <ExternalLink size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(pl); }}>
                    <Trash2 size={14} />
                  </Button>
                  {expanded === pl.id ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </div>
              </div>

              {/* Expanded track list */}
              {expanded === pl.id && expandedData && (
                <div className="border-t border-border">
                  {pl.is_smart && (
                    <div className="px-4 py-2 bg-secondary/20 flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => regenerateSmart(pl.id)}>
                        <Sparkles size={12} className="mr-1" /> Regenerate
                      </Button>
                    </div>
                  )}
                  {(expandedData.tracks ?? []).length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">Empty playlist</div>
                  ) : (
                    <div className="max-h-[400px] overflow-y-auto">
                      {(expandedData.tracks ?? []).map((t) => (
                        <div key={t.id} className="flex items-center gap-3 px-4 py-2 hover:bg-secondary/20 transition-colors group">
                          <span className="text-xs text-muted-foreground w-6 text-right">{t.position}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                            player.play({ id: t.track_path, title: t.title, artist: t.artist, albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined });
                          }}>
                            <Play size={12} />
                          </Button>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{t.title}</div>
                            <div className="text-xs text-muted-foreground truncate">{t.artist} — {t.album}</div>
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDuration(Math.floor(t.duration))}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive" onClick={() => removeTrack(pl.id, t.position)}>
                            <X size={12} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Playlist"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

// ── Create form ─────────────────────────────────────────────────

function CreatePlaylistForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/playlists", "POST", { name: name.trim(), description: desc });
      toast.success("Playlist created");
      onCreated();
    } catch { toast.error("Failed to create"); } finally { setSaving(false); }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="flex items-center gap-3 mb-3">
        <Plus size={16} className="text-primary" />
        <span className="font-semibold text-sm">New Playlist</span>
      </div>
      <div className="flex gap-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" className="flex-1" />
        <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" className="flex-1" />
        <Button onClick={submit} disabled={saving || !name.trim()}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : "Create"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

// ── Smart playlist form ─────────────────────────────────────────

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
  values: string[]; // multi-select for genre, artist, etc.
  rangeMin: string;
  rangeMax: string;
}

function SmartPlaylistForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
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
    setRules([...rules, { field: "genre", op: "contains", values: [], rangeMin: "", rangeMax: "" }]);
  }
  function removeRule(i: number) {
    setRules(rules.filter((_, idx) => idx !== i));
  }
  function updateField(i: number, field: string) {
    const updated = [...rules];
    const ops = getOpsForField(field);
    updated[i] = { field, op: ops[0]?.value ?? "eq", values: [], rangeMin: "", rangeMax: "" };
    setRules(updated);
  }
  function toggleValue(i: number, val: string) {
    const updated = [...rules];
    const r = updated[i]!;
    const has = r.values.includes(val);
    r.values = has ? r.values.filter((v) => v !== val) : [...r.values, val];
    setRules(updated);
  }
  function setRange(i: number, key: "rangeMin" | "rangeMax", val: string) {
    const updated = [...rules];
    updated[i]![key] = val;
    setRules(updated);
  }

  function getOpsForField(field: string): { value: string; label: string }[] {
    if (field === "bpm" || field === "year") return [{ value: "between", label: "between" }];
    if (field === "energy" || field === "danceability" || field === "valence") return [{ value: "gte", label: ">=" }, { value: "lte", label: "<=" }];
    if (field === "genre") return [{ value: "contains", label: "contains" }];
    return [{ value: "eq", label: "equals" }];
  }

  function getOptionsForField(field: string): string[] {
    if (!options) return [];
    switch (field) {
      case "genre": return options.genres;
      case "format": return options.formats;
      case "audio_key": return options.keys;
      case "artist": return options.artists;
      default: return [];
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
        rules: rules.filter(ruleHasValue).map((r) => {
          if (isRangeField(r.field)) {
            const min = parseFloat(r.rangeMin) || 0;
            const max = parseFloat(r.rangeMax) || 9999;
            return { field: r.field, op: "between", value: [min, max] };
          }
          if (r.values.length === 1) {
            return { field: r.field, op: r.op, value: r.values[0] };
          }
          // Multiple values: create OR sub-rules
          return { field: r.field, op: r.op, value: r.values.join("|") };
        }),
        limit,
        sort,
      };
      const { id } = await api<{ id: number }>("/api/playlists", "POST", {
        name: name.trim(),
        is_smart: true,
        smart_rules: smartRules,
      });
      await api(`/api/playlists/${id}/generate`, "POST");
      toast.success("Smart playlist created");
      onCreated();
    } catch { toast.error("Failed to create"); } finally { setSaving(false); }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="flex items-center gap-3 mb-4">
        <Sparkles size={16} className="text-primary" />
        <span className="font-semibold text-sm">Smart Playlist</span>
      </div>
      <div className="space-y-4">
        <div className="flex gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Playlist name" className="flex-1" />
          <Select value={match} onValueChange={(v) => setMatch(v as "all" | "any")}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Match all</SelectItem>
              <SelectItem value="any">Match any</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value) || 50)} min={1} max={500} className="w-20" placeholder="Limit" />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="random">Random</SelectItem>
              <SelectItem value="popularity">Most Popular</SelectItem>
              <SelectItem value="energy">Highest Energy</SelectItem>
              <SelectItem value="bpm">By BPM</SelectItem>
              <SelectItem value="title">Alphabetical</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rules.map((rule, i) => (
          <div key={i} className="border border-border rounded-lg p-3 space-y-2">
            <div className="flex gap-2 items-center">
              <Select value={rule.field} onValueChange={(v) => updateField(i, v)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SMART_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>

              {isRangeField(rule.field) && (
                <>
                  <span className="text-xs text-muted-foreground">from</span>
                  <Input
                    type="number"
                    value={rule.rangeMin}
                    onChange={(e) => setRange(i, "rangeMin", e.target.value)}
                    placeholder={rule.field === "year" ? options?.year_range[0] ?? "1960" : rule.field === "bpm" ? String(options?.bpm_range[0] ?? 60) : "0"}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="number"
                    value={rule.rangeMax}
                    onChange={(e) => setRange(i, "rangeMax", e.target.value)}
                    placeholder={rule.field === "year" ? options?.year_range[1] ?? "2026" : rule.field === "bpm" ? String(options?.bpm_range[1] ?? 200) : "1"}
                    className="w-24"
                  />
                </>
              )}

              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={() => removeRule(i)}>
                <X size={14} />
              </Button>
            </div>

            {/* Multi-select options */}
            {isMultiSelectField(rule.field) && (
              <div>
                {/* Selected badges */}
                {rule.values.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {rule.values.map((v) => (
                      <Badge key={v} variant="secondary" className="text-xs pl-2 pr-1 py-0.5 gap-1">
                        {v}
                        <button onClick={() => toggleValue(i, v)} className="hover:text-destructive ml-0.5">
                          <X size={10} />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                {/* Available options */}
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {getOptionsForField(rule.field)
                    .filter((o) => !rule.values.includes(o))
                    .map((opt) => (
                      <button
                        key={opt}
                        onClick={() => toggleValue(i, opt)}
                        className="text-[11px] px-2 py-1 rounded-md bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {opt}
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
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !name.trim() || rules.every((r) => !ruleHasValue(r))}>
            {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <Sparkles size={14} className="mr-1" />}
            Create
          </Button>
        </div>
      </div>
    </Card>
  );
}
