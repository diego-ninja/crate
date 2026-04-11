import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FolderOpen,
  FolderTree,
  Database,
  Clock,
  Wifi,
  Cpu,
  Info,
  Sliders,
  X,
  Plus,
} from "lucide-react";

interface SettingsData {
  schedules: Record<string, number>;
  worker: { max_workers: number };
  enrichment: Record<string, boolean>;
  db_stats: Record<string, { size: number; rows: number }>;
  library: {
    path: string;
    folder_pattern: string;
    audio_extensions: string[];
  };
  processing: {
    mb_auto_apply_threshold: number;
    enrichment_min_age_hours: number;
    max_track_popularity: number;
  };
  soulseek?: {
    url: string;
    quality: string;
    min_bitrate: number;
    username: string;
    shares_music: boolean;
  };
  about: {
    version: string;
    git_commit: string;
    python: string;
    uptime_seconds: number;
    artists: number;
    albums: number;
    tracks: number;
    total_size_gb: number;
  };
}

interface AuditEntry {
  id: number;
  timestamp: string;
  action: string;
  target_type: string;
  target_name: string;
  details: Record<string, unknown>;
  user_id: number | null;
  task_id: string | null;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

const SCHEDULE_LABELS: Record<string, string> = {
  library_sync: "Library Sync",
  compute_analytics: "Compute Analytics",
  enrich_artists: "Artist Enrichment",
  fetch_artwork_all: "Fetch Artwork",
  scan: "Library Scan",
};

const ENRICHMENT_LABELS: Record<string, string> = {
  lastfm: "Last.fm",
  spotify: "Spotify",
  fanart: "Fanart.tv",
  setlistfm: "Setlist.fm",
  musicbrainz: "MusicBrainz",
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function saveSetting(section: string, data: Record<string, unknown>) {
  try {
    await api(`/api/settings/${section}`, "PUT", data);
    toast.success("Setting saved");
  } catch {
    toast.error("Failed to save setting");
  }
}

export function Settings() {
  const { data: settings, loading, refetch } = useApi<SettingsData>("/api/settings");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-20 text-sm text-muted-foreground">
        Failed to load settings
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Settings</h1>
      <Tabs defaultValue="general">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
        <TabsList className="min-w-max">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="processing">Processing</TabsTrigger>
          <TabsTrigger value="cache">Cache</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
          <TabsTrigger value="about">About</TabsTrigger>
        </TabsList>
        </div>
        <TabsContent value="general">
          <GeneralTab settings={settings} refetch={refetch} />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTab schedules={settings.schedules} refetch={refetch} />
        </TabsContent>
        <TabsContent value="enrichment">
          <EnrichmentTab enrichment={settings.enrichment} refetch={refetch} />
        </TabsContent>
        <TabsContent value="processing">
          <ProcessingTab settings={settings} />
        </TabsContent>
        <TabsContent value="cache">
          <CacheTab dbStats={settings.db_stats} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab about={settings.about} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab({ settings, refetch }: { settings: SettingsData; refetch: () => void }) {
  const [workers, setWorkers] = useState(settings.worker.max_workers);
  const [saving, setSaving] = useState(false);
  const [folderPattern, setFolderPattern] = useState(settings.library?.folder_pattern ?? "artist/album");

  async function saveWorkers(value: number) {
    setSaving(true);
    try {
      await api("/api/settings/worker", "PUT", { max_workers: value });
      toast.success(`Worker slots set to ${value}`);
      refetch();
    } catch {
      toast.error("Failed to save worker settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderOpen size={14} /> Library
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Path</span>
            <code className="text-sm bg-muted px-2 py-1 rounded">/music</code>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderTree size={14} /> Folder Organization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <span className="text-sm text-muted-foreground sm:w-32">Structure</span>
            <Select value={folderPattern} onValueChange={(v) => { setFolderPattern(v); saveSetting("library", { folder_pattern: v }); }}>
              <SelectTrigger className="w-full sm:w-[250px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="artist/album">Artist / Album</SelectItem>
                <SelectItem value="artist/year/album">Artist / Year / Album</SelectItem>
                <SelectItem value="artist/year-album">Artist / Year - Album</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            Example: {folderPattern === "artist/year/album" ? "Quicksand/1993/Slip/" : folderPattern === "artist/year-album" ? "Quicksand/1993 - Slip/" : "Quicksand/Slip/"}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock size={14} /> Worker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Max slots</span>
            <div className="flex items-center gap-1 border border-border rounded-md">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setWorkers(n);
                    saveWorkers(n);
                  }}
                  disabled={saving}
                  className={`px-2.5 py-1.5 text-xs font-mono transition-colors ${
                    n === workers
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  } ${n === 1 ? "rounded-l-md" : ""} ${n === 10 ? "rounded-r-md" : ""}`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              Currently {workers} slot{workers !== 1 ? "s" : ""}
            </span>
          </div>
        </CardContent>
      </Card>

      <TidalAuthCard />
      <SoulseekCard />
    </div>
  );
}

function SoulseekCard() {
  const [slskStatus, setSlskStatus] = useState<{ connected: boolean; state: string } | null>(null);
  const [soulseekQuality, setSoulseekQuality] = useState("flac");
  const [soulseekMinBitrate, setSoulseekMinBitrate] = useState("320");

  useEffect(() => {
    api<{ connected: boolean; state: string }>("/api/acquisition/status")
      .then((s) => {
        setSlskStatus(s);
      })
      .catch(() => setSlskStatus({ connected: false, state: "unknown" }));
  }, []);

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Wifi size={14} /> Soulseek
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${slskStatus?.connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-sm">{slskStatus?.connected ? `Connected (${slskStatus.state})` : "Disconnected"}</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground w-32">Quality</span>
          <Select value={soulseekQuality} onValueChange={(v) => { setSoulseekQuality(v); saveSetting("soulseek", { quality: v }); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flac">FLAC only</SelectItem>
              <SelectItem value="flac_320">FLAC + MP3 320k</SelectItem>
              <SelectItem value="any">Any quality</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground w-32">Min bitrate</span>
          <Input type="number" className="w-24 h-8" value={soulseekMinBitrate}
            onChange={(e) => setSoulseekMinBitrate(e.target.value)}
            onBlur={() => saveSetting("soulseek", { min_bitrate: parseInt(soulseekMinBitrate) || 320 })} />
          <span className="text-xs text-muted-foreground">kbps</span>
        </div>
      </CardContent>
    </Card>
  );
}

function TidalAuthCard() {
  const [status, setStatus] = useState<{ authenticated: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginMessages, setLoginMessages] = useState<string[]>([]);

  useEffect(() => {
    api<{ authenticated: boolean }>("/api/tidal/status").then(setStatus).catch(() => {});
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const r = await api<{ success: boolean }>("/api/tidal/auth/refresh", "POST");
      if (r.success) {
        toast.success("Tidal token refreshed");
        setStatus({ authenticated: true });
      } else {
        toast.error("Refresh failed — try logging in again");
      }
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLogin() {
    setLoggingIn(true);
    setLoginMessages([]);
    try {
      const res = await fetch("/api/tidal/auth/login", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok || !res.body) {
        toast.error("Failed to start Tidal login");
        setLoggingIn(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const msg = line.slice(6).trim();
          if (!msg) continue;
          setLoginMessages((prev) => [...prev, msg]);
          if (msg === "AUTH_SUCCESS") {
            setLoggingIn(false);
            setStatus({ authenticated: true });
            toast.success("Tidal authenticated!");
            return;
          } else if (msg.startsWith("AUTH_FAILED") || msg.startsWith("AUTH_ERROR") || msg.startsWith("AUTH_TIMEOUT")) {
            setLoggingIn(false);
            toast.error("Tidal login failed");
            return;
          }
        }
      }
      setLoggingIn(false);
    } catch {
      setLoggingIn(false);
      toast.error("Failed to start login");
    }
  }

  async function handleLogout() {
    try {
      await api("/api/tidal/auth/logout", "POST");
      setStatus({ authenticated: false });
      toast.success("Tidal logged out");
    } catch {
      toast.error("Logout failed");
    }
  }

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Wifi size={14} /> Tidal
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${status?.authenticated ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-sm">{status?.authenticated ? "Authenticated" : "Not authenticated"}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {status?.authenticated ? (
            <>
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                {refreshing ? <Loader2 size={12} className="animate-spin mr-1" /> : <RefreshCw size={12} className="mr-1" />}
                Refresh Token
              </Button>
              <Button variant="outline" size="sm" className="text-red-500 border-red-500/30" onClick={handleLogout}>
                Logout
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleLogin} disabled={loggingIn}>
              {loggingIn ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
              {loggingIn ? "Waiting for auth..." : "Login to Tidal"}
            </Button>
          )}
        </div>
        {loginMessages.length > 0 && (
          <div className="mt-3 p-3 bg-secondary/30 rounded text-xs font-mono max-h-[150px] overflow-y-auto">
            {loginMessages.map((msg, i) => (
              <div key={i} className={msg.includes("AUTH_SUCCESS") ? "text-green-500" : msg.includes("AUTH_") ? "text-red-500" : "text-muted-foreground"}>
                {msg}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SchedulesTab({
  schedules,
  refetch,
}: {
  schedules: Record<string, number>;
  refetch: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const [k, v] of Object.entries(schedules)) {
      m[k] = v === 0 ? "0" : String(Math.round(v / 60));
    }
    return m;
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(draft)) {
        const mins = parseInt(v, 10);
        payload[k] = isNaN(mins) || mins <= 0 ? 0 : mins * 60;
      }
      await api("/api/settings/schedules", "PUT", payload);
      toast.success("Schedules saved");
      refetch();
    } catch {
      toast.error("Failed to save schedules");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm">Task Schedules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.keys(schedules).map((key) => {
            const mins = draft[key] ?? "0";
            const disabled = mins === "0" || mins === "";
            return (
              <div key={key} className="flex items-center gap-4">
                <span className="text-sm w-40">
                  {SCHEDULE_LABELS[key] ?? key.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    className="w-24 h-8 text-sm"
                    value={mins}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
                <Badge variant={disabled ? "secondary" : "default"} className="text-[10px]">
                  {disabled ? "Disabled" : "Active"}
                </Badge>
              </div>
            );
          })}
          <div className="pt-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 size={12} className="animate-spin mr-1" />
              ) : (
                <Save size={12} className="mr-1" />
              )}
              Save Schedules
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EnrichmentTab({
  enrichment,
  refetch,
}: {
  enrichment: Record<string, boolean>;
  refetch: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, boolean>>({ ...enrichment });
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    setDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings/enrichment", "PUT", draft);
      toast.success("Enrichment settings saved");
      refetch();
    } catch {
      toast.error("Failed to save enrichment settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm">Enrichment Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(enrichment).map((key) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer select-none"
            >
              <button
                type="button"
                role="switch"
                aria-checked={draft[key]}
                onClick={() => toggle(key)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  draft[key] ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    draft[key] ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm">
                {ENRICHMENT_LABELS[key] ?? key}
              </span>
              {draft[key] ? (
                <CheckCircle2 size={14} className="text-green-500" />
              ) : (
                <XCircle size={14} className="text-muted-foreground" />
              )}
            </label>
          ))}
          <div className="pt-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 size={12} className="animate-spin mr-1" />
              ) : (
                <Save size={12} className="mr-1" />
              )}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProcessingTab({ settings }: { settings: SettingsData }) {
  const proc = settings.processing ?? { mb_auto_apply_threshold: 85, enrichment_min_age_hours: 24, max_track_popularity: 50 };
  const exts = settings.library?.audio_extensions ?? [".flac", ".mp3", ".ogg", ".opus", ".m4a"];

  const [threshold, setThreshold] = useState(proc.mb_auto_apply_threshold);
  const [minAge, setMinAge] = useState(proc.enrichment_min_age_hours);
  const [maxPop, setMaxPop] = useState(proc.max_track_popularity);
  const [audioExts, setAudioExts] = useState<string[]>(exts);
  const [newExt, setNewExt] = useState("");

  function removeExt(ext: string) {
    const updated = audioExts.filter((e) => e !== ext);
    setAudioExts(updated);
    saveSetting("library", { audio_extensions: updated });
  }

  function addExt() {
    const ext = newExt.trim().toLowerCase();
    if (!ext) return;
    const normalized = ext.startsWith(".") ? ext : `.${ext}`;
    if (audioExts.includes(normalized)) return;
    const updated = [...audioExts, normalized];
    setAudioExts(updated);
    setNewExt("");
    saveSetting("library", { audio_extensions: updated });
  }

  return (
    <div className="space-y-4 mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Sliders size={14} /> MusicBrainz Auto-Apply Threshold
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Automatically apply MusicBrainz tags when match score exceeds this threshold
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={50}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onMouseUp={() => saveSetting("processing", { mb_auto_apply_threshold: threshold })}
              onTouchEnd={() => saveSetting("processing", { mb_auto_apply_threshold: threshold })}
              className="flex-1 accent-primary"
            />
            <span className="text-sm font-mono w-12 text-right">{threshold}%</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock size={14} /> Enrichment Min Age
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Minimum hours before re-enriching an artist
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={168}
              className="w-24 h-8 text-sm"
              value={minAge}
              onChange={(e) => setMinAge(Number(e.target.value))}
              onBlur={() => saveSetting("processing", { enrichment_min_age_hours: minAge })}
            />
            <span className="text-xs text-muted-foreground">hours (1-168)</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu size={14} /> Max Track Popularity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Maximum tracks to fetch popularity data for per artist
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={10}
              max={500}
              className="w-24 h-8 text-sm"
              value={maxPop}
              onChange={(e) => setMaxPop(Number(e.target.value))}
              onBlur={() => saveSetting("processing", { max_track_popularity: maxPop })}
            />
            <span className="text-xs text-muted-foreground">tracks (10-500)</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FolderOpen size={14} /> Audio Extensions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {audioExts.map((ext) => (
              <Badge key={ext} variant="secondary" className="text-xs gap-1">
                {ext}
                <button onClick={() => removeExt(ext)} className="ml-1 hover:text-destructive">
                  <X size={10} />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="w-32 h-8 text-sm"
              placeholder=".wav"
              value={newExt}
              onChange={(e) => setNewExt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addExt(); }}
            />
            <Button variant="outline" size="sm" onClick={addExt}>
              <Plus size={12} className="mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CacheTab({ dbStats }: { dbStats: Record<string, { size: number; rows: number }> }) {
  const [clearing, setClearing] = useState<string | null>(null);

  async function clearCache(type: string) {
    setClearing(type);
    try {
      await api("/api/settings/cache/clear", "POST", { type });
      toast.success(`Cache cleared: ${type}`);
    } catch {
      toast.error(`Failed to clear ${type} cache`);
    } finally {
      setClearing(null);
    }
  }

  const cacheActions = [
    { type: "all", label: "Clear All Cache", variant: "destructive" as const },
    { type: "enrichment", label: "Clear Enrichment", variant: "outline" as const },
    { type: "lastfm", label: "Clear Last.fm", variant: "outline" as const },
    { type: "analytics", label: "Clear Analytics", variant: "outline" as const },
  ];

  return (
    <div className="space-y-4 mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Database size={14} /> Database Tables
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(dbStats).map(([name, stats]) => (
                <TableRow key={name}>
                  <TableCell className="text-sm font-mono">{name}</TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {stats.rows.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatBytes(stats.size)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm">Cache Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {cacheActions.map(({ type, label, variant }) => (
              <Button
                key={type}
                variant={variant}
                size="sm"
                onClick={() => clearCache(type)}
                disabled={clearing !== null}
              >
                {clearing === type ? (
                  <Loader2 size={12} className="animate-spin mr-1" />
                ) : (
                  <Trash2 size={12} className="mr-1" />
                )}
                {label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuditLogTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const limit = 50;

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      try {
        const newOffset = reset ? 0 : offset;
        const filterParam = actionFilter !== "all" ? `&action=${actionFilter}` : "";
        const res = await api<AuditResponse>(
          `/api/manage/audit-log?limit=${limit}&offset=${newOffset}${filterParam}`,
        );
        if (reset) {
          setEntries(res.entries);
          setOffset(res.entries.length);
        } else {
          setEntries((prev) => [...prev, ...res.entries]);
          setOffset((prev) => prev + res.entries.length);
        }
        setTotal(res.total);
      } catch {
        toast.error("Failed to load audit log");
      } finally {
        setLoading(false);
      }
    },
    [offset, actionFilter],
  );

  useEffect(() => {
    load(true);
  }, [actionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = [...new Set(entries.map((e) => e.action))].sort();

  return (
    <div className="space-y-4 mt-4">
      <Card className="bg-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              Audit Log
              {total > 0 && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({total} entries)
                </span>
              )}
            </CardTitle>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue placeholder="Filter by action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No audit log entries
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell
                        className="text-xs text-muted-foreground whitespace-nowrap"
                        title={new Date(entry.timestamp).toLocaleString()}
                      >
                        {formatTimestamp(entry.timestamp)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.target_type}
                      </TableCell>
                      <TableCell className="text-sm max-w-[250px] truncate">
                        {entry.target_name}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {offset < total && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => load(false)}
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 size={12} className="animate-spin mr-1" />
                    ) : null}
                    Load More ({total - offset} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function AboutTab({ about }: { about: SettingsData["about"] }) {
  if (!about) {
    return (
      <div className="mt-4 text-center py-8 text-sm text-muted-foreground">
        About information unavailable
      </div>
    );
  }

  return (
    <div className="mt-4">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info size={14} /> About MusicDock
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow label="Version" value={about.version} />
            <InfoRow label="Git Commit" value={about.git_commit} mono />
            <InfoRow label="Python" value={about.python} />
            <InfoRow label="Uptime" value={formatUptime(about.uptime_seconds)} />
            <InfoRow label="Artists" value={formatNumber(about.artists)} />
            <InfoRow label="Albums" value={formatNumber(about.albums)} />
            <InfoRow label="Tracks" value={formatNumber(about.tracks)} />
            <InfoRow label="Library Size" value={`${about.total_size_gb} GB`} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
