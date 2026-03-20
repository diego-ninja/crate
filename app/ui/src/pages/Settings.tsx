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
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  FolderOpen,
  Database,
  Clock,
  Wifi,
} from "lucide-react";

interface SettingsData {
  schedules: Record<string, number>;
  worker: { max_workers: number };
  enrichment: Record<string, boolean>;
  navidrome: { connected: boolean; version: string | null };
  db_stats: Record<string, { size: number; rows: number }>;
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
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="schedules">Schedules</TabsTrigger>
          <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
          <TabsTrigger value="cache">Cache</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <GeneralTab settings={settings} refetch={refetch} />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTab schedules={settings.schedules} refetch={refetch} />
        </TabsContent>
        <TabsContent value="enrichment">
          <EnrichmentTab enrichment={settings.enrichment} refetch={refetch} />
        </TabsContent>
        <TabsContent value="cache">
          <CacheTab dbStats={settings.db_stats} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GeneralTab({ settings, refetch }: { settings: SettingsData; refetch: () => void }) {
  const [workers, setWorkers] = useState(settings.worker.max_workers);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [navStatus, setNavStatus] = useState(settings.navidrome);

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

  async function testNavidrome() {
    setTesting(true);
    try {
      const result = await api<{ connected: boolean; version: string | null }>(
        "/api/settings/navidrome/test",
        "POST",
      );
      setNavStatus(result);
      if (result.connected) {
        toast.success(`Navidrome connected (v${result.version})`);
      } else {
        toast.error("Navidrome connection failed");
      }
    } catch {
      toast.error("Connection test failed");
    } finally {
      setTesting(false);
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

      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Wifi size={14} /> Navidrome
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  navStatus.connected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm">
                {navStatus.connected
                  ? `Connected (v${navStatus.version})`
                  : "Disconnected"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={testNavidrome}
              disabled={testing}
            >
              {testing ? (
                <Loader2 size={12} className="animate-spin mr-1" />
              ) : (
                <RefreshCw size={12} className="mr-1" />
              )}
              Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
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
