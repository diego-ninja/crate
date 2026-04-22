import { useState, useEffect, useCallback, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import { Input } from "@crate/ui/shadcn/input";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@crate/ui/shadcn/table";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { cn, formatNumber } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  Wifi,
  Info,
  X,
  Plus,
  Download,
  Bell,
  ScrollText,
  HardDrive,
  ExternalLink,
  Activity,
  Zap,
  Database,
  Bot,
  ShieldCheck,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────

interface SettingsData {
  schedules: Record<string, number>;
  worker: { max_workers: number };
  enrichment: Record<string, boolean>;
  db_stats: Record<string, { size: number; rows: number }>;
  library: {
    path: string;
    storage_layout: string;
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
  telegram?: {
    enabled: boolean;
    bot_token: string;
    chat_id: string;
    has_token: boolean;
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

interface WorkerStatus {
  engine: string;
  running: number;
  pending: number;
  running_tasks: { id: string; type: string; pool: string }[];
  pending_tasks: { id: string; type: string; pool: string }[];
}

interface DownloadPolicy {
  downloads_allowed_now: boolean;
  active_users: number;
  active_streams: number;
  time_window: { enabled: boolean; in_window: boolean; start: string; end: string };
  user_limit: { enabled: boolean; max: number };
  stream_limit: { enabled: boolean; max: number };
}

interface AcquisitionStatus {
  tidal: { authenticated: boolean };
  soulseek: { connected: boolean; state: string };
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

// ── Helpers ────────────────────────────────────────────────────

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
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTimestamp(ts: string): string {
  const diffMin = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Shared components ──────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
        {description ? <p className="text-sm text-white/45">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-sm border border-white/10 bg-black/20 p-0.5 transition-colors disabled:opacity-50 ${
        checked ? "border-primary/35 bg-primary/15" : "bg-white/[0.04]"
      }`}
    >
      <span className={`pointer-events-none block h-4 w-4 rounded-[2px] bg-white shadow-sm transition-transform ${
        checked ? "translate-x-5" : "translate-x-0"
      }`} />
    </button>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border border-white/6 bg-black/15 p-3 md:grid-cols-[200px_minmax(0,1fr)] md:items-center">
      <div className="space-y-1">
        <span className="text-sm text-muted-foreground">{label}</span>
        {hint && <p className="text-[11px] leading-relaxed text-white/30">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <div className={`w-2 h-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />;
}

function StatTile({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-white/8 bg-black/20 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs uppercase tracking-[0.12em] text-white/35">{label}</div>
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-white/70">
          <Icon size={16} />
        </div>
      </div>
      <div className="text-xl font-semibold tracking-tight text-white">{value}</div>
    </div>
  );
}

function PanelCard({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Info;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="border-white/10 bg-panel-surface shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_16px_32px_rgba(6,182,212,0.14)]">
              <Icon size={18} />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-base text-white">{title}</CardTitle>
              {description ? <CardDescription className="text-sm text-white/45">{description}</CardDescription> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-6">
        {children}
      </CardContent>
    </Card>
  );
}

// ── Sidebar nav ────────────────────────────────────────────────

type SettingsSection = "general" | "downloads" | "schedules" | "enrichment" | "notifications" | "storage" | "audit";

const NAV_ITEMS: { id: SettingsSection; label: string; description: string; icon: typeof Info }[] = [
  { id: "general", label: "General", description: "Library, worker and runtime basics", icon: Info },
  { id: "downloads", label: "Downloads", description: "Tidal, Soulseek and quiet hours", icon: Download },
  { id: "schedules", label: "Schedules", description: "Recurring tasks and cadence", icon: Clock },
  { id: "enrichment", label: "Enrichment", description: "Sources, thresholds and file types", icon: Zap },
  { id: "notifications", label: "Notifications", description: "Telegram bot and alerts", icon: Bell },
  { id: "storage", label: "Storage", description: "Database footprint and cache tools", icon: HardDrive },
  { id: "audit", label: "Audit Log", description: "Operational trail and filters", icon: ScrollText },
];

// ── Main ───────────────────────────────────────────────────────

export function Settings() {
  const { data: settings, loading, refetch } = useApi<SettingsData>("/api/settings");
  const [section, setSection] = useState<SettingsSection>("general");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  if (!settings) {
    return <div className="text-center py-20 text-sm text-muted-foreground">Failed to load settings</div>;
  }

  const activeSchedules = Object.values(settings.schedules || {}).filter((seconds) => seconds > 0).length;
  const currentNav = NAV_ITEMS.find((item) => item.id === section) ?? NAV_ITEMS[0]!;
  const CurrentIcon = currentNav.icon;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">Settings</h1>
                <p className="text-sm text-white/55">
                  Runtime controls, acquisition policy, enrichment behavior and operational guardrails.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip icon={Database}>
                {formatNumber(settings.about.tracks)} tracks indexed
              </CrateChip>
              <CrateChip icon={Clock}>
                Uptime {formatUptime(settings.about.uptime_seconds)}
              </CrateChip>
              <CrateChip icon={Zap}>
                {activeSchedules} active schedules
              </CrateChip>
              <CrateChip icon={Bot} className={settings.telegram?.enabled ? "border-green-500/25 bg-green-500/10 text-green-300" : undefined}>
                Telegram {settings.telegram?.enabled ? "enabled" : "idle"}
              </CrateChip>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[520px]">
            <StatTile icon={Activity} label="Version" value={settings.about.version || "dev"} />
            <StatTile icon={HardDrive} label="Library" value={`${settings.about.total_size_gb} GB`} />
            <StatTile icon={Download} label="Storage" value={settings.library?.storage_layout || "artist/album"} />
            <StatTile icon={ScrollText} label="Commit" value={settings.about.git_commit?.slice(0, 8) || "local"} />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="hidden h-fit border-white/10 bg-panel-surface xl:block">
          <CardContent className="p-3">
            <div className="space-y-1">
              {NAV_ITEMS.map(({ id, label, description, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors",
                    section === id
                      ? "border-white/12 bg-white/[0.06] text-white shadow-[0_12px_28px_rgba(0,0,0,0.18)]"
                      : "border-transparent text-white/55 hover:border-white/8 hover:bg-white/[0.03] hover:text-white/80",
                  )}
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
                    <Icon size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-white/35">{description}</div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary">
                <CurrentIcon size={18} />
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-white">{currentNav.label}</h2>
                <p className="text-sm text-white/45">{currentNav.description}</p>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 xl:hidden">
              {NAV_ITEMS.map(({ id, label }) => (
                <CratePill key={id} active={section === id} onClick={() => setSection(id)}>
                  {label}
                </CratePill>
              ))}
            </div>
          </div>

          {section === "general" && <GeneralSection settings={settings} />}
          {section === "downloads" && <DownloadsSection refetch={refetch} />}
          {section === "schedules" && <SchedulesSection schedules={settings.schedules} refetch={refetch} />}
          {section === "enrichment" && <EnrichmentSection settings={settings} refetch={refetch} />}
          {section === "notifications" && <NotificationsSection telegram={settings.telegram} refetch={refetch} />}
          {section === "storage" && <StorageSection dbStats={settings.db_stats} />}
          {section === "audit" && <AuditSection />}
        </div>
      </div>
    </div>
  );
}

// ── General ────────────────────────────────────────────────────

function GeneralSection({ settings }: { settings: SettingsData }) {
  const { data: worker } = useApi<WorkerStatus>("/api/worker/status");
  const about = settings.about;

  return (
    <>
      <Section title="Library" description="Core library path, storage layout and current footprint.">
        <PanelCard
          icon={HardDrive}
          title="Library Runtime"
          description="Where Crate reads from and how the indexed collection is currently shaped."
        >
            <FieldRow label="Path">
              <code className="rounded-md border border-white/8 bg-black/25 px-3 py-2 font-mono text-sm">{settings.library?.path || "/music"}</code>
            </FieldRow>
            <FieldRow label="Layout">
              <span className="text-sm">{settings.library?.storage_layout || "artist/album"}</span>
            </FieldRow>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile icon={Info} label="Artists" value={formatNumber(about.artists)} />
              <StatTile icon={Info} label="Albums" value={formatNumber(about.albums)} />
              <StatTile icon={Info} label="Tracks" value={formatNumber(about.tracks)} />
              <StatTile icon={HardDrive} label="Size" value={`${about.total_size_gb} GB`} />
            </div>
        </PanelCard>
      </Section>

      <Section title="Worker" description="Live execution engine status, running work and queue pressure.">
        <PanelCard
          icon={Activity}
          title="Worker Engine"
          description="Background tasks, pool health and current queue state."
        >
            <FieldRow label="Engine">
              <span className="rounded-md border border-white/8 bg-black/25 px-3 py-2 font-mono text-sm">
                {worker?.engine || "dramatiq"}
              </span>
            </FieldRow>
            <FieldRow label="Status">
              <div className="flex items-center gap-3">
                {worker && worker.running > 0 ? (
                  <Badge className="border-primary/30 bg-primary/15 text-[10px] text-primary">
                    <Activity size={10} className="mr-1" />
                    {worker.running} running
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Idle</Badge>
                )}
                {worker && worker.pending > 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {worker.pending} pending
                  </Badge>
                )}
              </div>
            </FieldRow>
            {worker && worker.running_tasks.length > 0 && (
              <div className="space-y-2 pt-1">
                {worker.running_tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md border border-white/6 bg-black/15 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 size={10} className="animate-spin text-primary" />
                    <span className="font-mono">{t.type}</span>
                    <span className="text-white/20">{t.id}</span>
                    <Badge variant="outline" className="px-1 py-0 text-[9px]">{t.pool}</Badge>
                  </div>
                ))}
              </div>
            )}
        </PanelCard>
      </Section>

      <Section title="About" description="Runtime identity and deployment metadata for this admin instance.">
        <PanelCard
          icon={Info}
          title="Build & Runtime"
          description="Version fingerprint, Python runtime and current process uptime."
        >
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Version", value: about.version },
                { label: "Python", value: about.python },
                { label: "Uptime", value: formatUptime(about.uptime_seconds) },
                { label: "Commit", value: about.git_commit?.slice(0, 8), mono: true },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
                  <div className={`text-sm mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
                </div>
              ))}
            </div>
        </PanelCard>
      </Section>
    </>
  );
}

// ── Downloads ──────────────────────────────────────────────────

function DownloadsSection({ refetch: _refetch }: { refetch: () => void }) {
  return (
    <>
      <TidalCard />
      <SoulseekCard />
      <DownloadWindowCard />
    </>
  );
}

function TidalCard() {
  const { data: acqStatus, refetch } = useApi<AcquisitionStatus>("/api/acquisition/status");
  const [refreshing, setRefreshing] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null);

  const authenticated = acqStatus?.tidal?.authenticated ?? false;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const r = await api<{ success: boolean }>("/api/tidal/auth/refresh", "POST");
      if (r.success) { toast.success("Tidal token refreshed"); refetch(); }
      else toast.error("Refresh failed");
    } catch { toast.error("Refresh failed"); }
    finally { setRefreshing(false); }
  }

  async function handleLogin() {
    setLoggingIn(true);
    setDeviceUrl(null);
    try {
      const res = await fetch("/api/tidal/auth/login", { method: "POST", credentials: "include" });
      if (!res.ok || !res.body) { toast.error("Failed to start Tidal login"); setLoggingIn(false); return; }
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
          // Extract URL from tiddl output
          const urlMatch = msg.match(/https?:\/\/[^\s]+/);
          if (urlMatch && !deviceUrl) {
            setDeviceUrl(urlMatch[0]);
            window.open(urlMatch[0], "_blank", "noopener");
          }
          if (msg === "AUTH_SUCCESS") {
            setLoggingIn(false); setDeviceUrl(null);
            toast.success("Tidal authenticated");
            refetch();
            return;
          } else if (msg.startsWith("AUTH_FAILED") || msg.startsWith("AUTH_ERROR") || msg.startsWith("AUTH_TIMEOUT")) {
            setLoggingIn(false); setDeviceUrl(null);
            toast.error("Tidal login failed");
            return;
          }
        }
      }
      setLoggingIn(false);
    } catch { setLoggingIn(false); toast.error("Login failed"); }
  }

  async function handleLogout() {
    try {
      await api("/api/tidal/auth/logout", "POST");
      toast.success("Tidal logged out");
      refetch();
    } catch { toast.error("Logout failed"); }
  }

  return (
    <Section title="Tidal" description="Authentication and token health for Tidal acquisition.">
      <PanelCard
        icon={Download}
        title="Tidal Access"
        description="Manage the current device auth session and token refresh flow."
      >
          <FieldRow label="Status">
            <StatusDot ok={authenticated} />
            <span className="text-sm">{authenticated ? "Authenticated" : "Not authenticated"}</span>
          </FieldRow>
          <div className="flex flex-wrap gap-2 md:pl-[212px]">
            {authenticated ? (
              <>
                <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
                  {refreshing ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
                  Refresh Token
                </Button>
                <Button variant="outline" size="sm" className="text-red-400 border-red-400/20 hover:bg-red-400/10" onClick={handleLogout}>
                  Logout
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={handleLogin} disabled={loggingIn}>
                {loggingIn ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <ExternalLink size={12} className="mr-1.5" />}
                {loggingIn ? "Waiting for auth..." : "Login to Tidal"}
              </Button>
            )}
          </div>
          {loggingIn && deviceUrl && (
            <div className="md:pl-[212px]">
              <p className="text-xs text-muted-foreground">
                A login page should have opened.{" "}
                <a href={deviceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Click here if it didn't open
                </a>
              </p>
            </div>
          )}
      </PanelCard>
    </Section>
  );
}

function SoulseekCard() {
  const { data: acqStatus } = useApi<AcquisitionStatus>("/api/acquisition/status");
  const slsk = acqStatus?.soulseek;
  const connected = slsk?.connected ?? false;

  const [quality, setQuality] = useState("flac");
  const [minBitrate, setMinBitrate] = useState("320");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) {
      api<Record<string, string>>("/api/settings").then((s: any) => {
        if (s?.soulseek) {
          setQuality(s.soulseek.quality || "flac");
          setMinBitrate(String(s.soulseek.min_bitrate || 320));
        }
        setLoaded(true);
      }).catch(() => setLoaded(true));
    }
  }, [loaded]);

  async function save(data: Record<string, unknown>) {
    try {
      await api("/api/settings/soulseek", "PUT", data);
      toast.success("Soulseek settings saved");
    } catch { toast.error("Failed to save"); }
  }

  return (
    <Section title="Soulseek" description="Fallback acquisition quality policy and slskd connectivity.">
      <PanelCard
        icon={Wifi}
        title="Soulseek Preferences"
        description="Acquisition quality defaults and current daemon connection state."
      >
          <FieldRow label="Status">
            <StatusDot ok={connected} />
            <span className="text-sm">{connected ? `Connected (${slsk?.state})` : "Disconnected"}</span>
            {!connected && (
              <span className="text-[10px] text-white/30">slskd container not running</span>
            )}
          </FieldRow>
          <FieldRow label="Quality">
            <AdminSelect
              value={quality}
              onChange={(value) => { setQuality(value); save({ quality: value }); }}
              options={[
                { value: "flac", label: "FLAC only" },
                { value: "flac_320", label: "FLAC + MP3 320k" },
                { value: "any", label: "Any quality" },
              ]}
              placeholder="Select quality"
              allowClear={false}
              triggerClassName="max-w-[240px]"
            />
          </FieldRow>
          <FieldRow label="Min bitrate">
            <Input
              type="number"
              className="h-10 w-24"
              value={minBitrate}
              onChange={(e) => setMinBitrate(e.target.value)}
              onBlur={() => save({ min_bitrate: parseInt(minBitrate) || 320 })}
            />
            <span className="text-xs text-muted-foreground">kbps</span>
          </FieldRow>
      </PanelCard>
    </Section>
  );
}

function DownloadWindowCard() {
  const { data: policy, refetch } = useApi<DownloadPolicy>("/api/admin/download-policy");
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState("02:00");
  const [windowEnd, setWindowEnd] = useState("07:00");
  const [maxUsers, setMaxUsers] = useState("0");
  const [maxStreams, setMaxStreams] = useState("0");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (policy && !loaded) {
      setWindowEnabled(policy.time_window.enabled);
      setWindowStart(policy.time_window.start);
      setWindowEnd(policy.time_window.end);
      setMaxUsers(String(policy.user_limit.max));
      setMaxStreams(String(policy.stream_limit.max));
      setLoaded(true);
    }
  }, [policy, loaded]);

  async function save(patch: Record<string, unknown>) {
    try {
      await api("/api/admin/download-policy", "PUT", patch);
      toast.success("Download policy updated");
      refetch();
    } catch { toast.error("Failed to update"); }
  }

  return (
    <Section title="Download Policy" description="Quiet hours and concurrency limits that gate acquisition.">
      <PanelCard
        icon={Clock}
        title="Quiet Hours & Limits"
        description="Keep downloads out of busy listening windows and cap concurrent activity."
      >
          {policy && (
            <FieldRow label="Current status">
              <Badge className={`text-[10px] ${
                policy.downloads_allowed_now
                  ? "bg-green-500/10 text-green-300 border-green-500/20"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/20"
              }`}>
                {policy.downloads_allowed_now ? "Downloads active" : "Downloads paused"}
              </Badge>
              {policy.active_users > 0 && (
                <span className="text-xs text-muted-foreground">{policy.active_users} user{policy.active_users > 1 ? "s" : ""} active</span>
              )}
            </FieldRow>
          )}
          <FieldRow label="Time window" hint="Only allow downloads during these hours">
            <Toggle checked={windowEnabled} onChange={(v) => { setWindowEnabled(v); save({ window_enabled: v }); }} />
            {windowEnabled && (
              <>
                <Input type="time" className="h-10 w-28" value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)} onBlur={() => save({ window_start: windowStart })} />
                <span className="text-xs text-muted-foreground">to</span>
                <Input type="time" className="h-10 w-28" value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)} onBlur={() => save({ window_end: windowEnd })} />
              </>
            )}
          </FieldRow>
          <FieldRow label="Max active users" hint="Pause if more than N users listening">
            <Input type="number" min={0} className="h-10 w-24" value={maxUsers}
              onChange={(e) => setMaxUsers(e.target.value)} onBlur={() => save({ max_active_users: parseInt(maxUsers) || 0 })} />
            <span className="text-[10px] text-white/30">0 = no limit</span>
          </FieldRow>
          <FieldRow label="Max active streams" hint="Pause if more than N concurrent streams">
            <Input type="number" min={0} className="h-10 w-24" value={maxStreams}
              onChange={(e) => setMaxStreams(e.target.value)} onBlur={() => save({ max_active_streams: parseInt(maxStreams) || 0 })} />
            <span className="text-[10px] text-white/30">0 = no limit</span>
          </FieldRow>
      </PanelCard>
    </Section>
  );
}

// ── Schedules ──────────────────────────────────────────────────

function SchedulesSection({ schedules, refetch }: { schedules: Record<string, number>; refetch: () => void }) {
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
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  return (
    <Section title="Task Schedules" description="Intervals for recurring maintenance and enrichment jobs.">
      <PanelCard
        icon={Clock}
        title="Recurring Jobs"
        description="Set the cadence for background maintenance. `0` disables a schedule."
        action={
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
            Save Schedules
          </Button>
        }
      >
          {Object.keys(schedules).map((key) => {
            const mins = draft[key] ?? "0";
            const active = mins !== "0" && mins !== "";
            return (
              <FieldRow key={key} label={SCHEDULE_LABELS[key] ?? key.replace(/_/g, " ")}>
                <Input
                  type="number"
                  min={0}
                  className="h-10 w-24"
                  value={mins}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                />
                <span className="text-xs text-muted-foreground">min</span>
                <Badge variant={active ? "default" : "secondary"} className="text-[10px]">
                  {active ? "Active" : "Off"}
                </Badge>
              </FieldRow>
            );
          })}
      </PanelCard>
    </Section>
  );
}

// ── Enrichment ─────────────────────────────────────────────────

function EnrichmentSection({ settings, refetch }: { settings: SettingsData; refetch: () => void }) {
  const enrichment = settings.enrichment;
  const proc = settings.processing ?? { mb_auto_apply_threshold: 85, enrichment_min_age_hours: 24, max_track_popularity: 50 };
  const exts = settings.library?.audio_extensions ?? [".flac", ".mp3", ".ogg", ".opus", ".m4a"];

  const [draft, setDraft] = useState<Record<string, boolean>>({ ...enrichment });
  const [saving, setSaving] = useState(false);
  const [threshold, setThreshold] = useState(proc.mb_auto_apply_threshold);
  const [minAge, setMinAge] = useState(proc.enrichment_min_age_hours);
  const [maxPop, setMaxPop] = useState(proc.max_track_popularity);
  const [audioExts, setAudioExts] = useState<string[]>(exts);
  const [newExt, setNewExt] = useState("");

  async function saveEnrichment() {
    setSaving(true);
    try {
      await api("/api/settings/enrichment", "PUT", draft);
      toast.success("Enrichment sources saved");
      refetch();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  async function saveSetting(section: string, data: Record<string, unknown>) {
    try {
      await api(`/api/settings/${section}`, "PUT", data);
      toast.success("Setting saved");
    } catch { toast.error("Failed to save"); }
  }

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
    <>
      <Section title="Sources" description="Enable or disable the remote metadata providers Crate can use.">
        <PanelCard
          icon={Zap}
          title="Enrichment Sources"
          description="Toggle providers that feed artist, album and social metadata into the library."
          action={
            <Button size="sm" onClick={saveEnrichment} disabled={saving}>
              {saving ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
              Save Sources
            </Button>
          }
        >
            {Object.keys(enrichment).map((key) => (
              <FieldRow key={key} label={ENRICHMENT_LABELS[key] ?? key}>
                <Toggle checked={draft[key] ?? false} onChange={(v) => setDraft((prev) => ({ ...prev, [key]: v }))} />
                {draft[key]
                  ? <CheckCircle2 size={13} className="text-green-500/70" />
                  : <XCircle size={13} className="text-white/20" />
                }
              </FieldRow>
            ))}
        </PanelCard>
      </Section>

      <Section title="Processing" description="Thresholds and limits that shape matching and scoring behavior.">
        <PanelCard
          icon={Activity}
          title="Processing Rules"
          description="Tune matcher confidence, re-enrichment freshness and popularity coverage."
        >
            <FieldRow label="MB auto-apply" hint="Min match score to auto-apply tags">
              <input
                type="range" min={50} max={100} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onMouseUp={() => saveSetting("processing", { mb_auto_apply_threshold: threshold })}
                onTouchEnd={() => saveSetting("processing", { mb_auto_apply_threshold: threshold })}
                className="w-32 accent-primary"
              />
              <span className="text-sm font-mono w-10 text-right">{threshold}%</span>
            </FieldRow>
            <FieldRow label="Re-enrich age" hint="Min hours before re-enriching">
              <Input type="number" min={1} max={168} className="h-10 w-24" value={minAge}
                onChange={(e) => setMinAge(Number(e.target.value))}
                onBlur={() => saveSetting("processing", { enrichment_min_age_hours: minAge })} />
              <span className="text-xs text-muted-foreground">hours</span>
            </FieldRow>
            <FieldRow label="Track popularity" hint="Max tracks per artist for popularity">
              <Input type="number" min={10} max={500} className="h-10 w-24" value={maxPop}
                onChange={(e) => setMaxPop(Number(e.target.value))}
                onBlur={() => saveSetting("processing", { max_track_popularity: maxPop })} />
              <span className="text-xs text-muted-foreground">tracks</span>
            </FieldRow>
        </PanelCard>
      </Section>

      <Section title="Audio Extensions" description="Recognized source formats when scanning and importing music.">
        <PanelCard
          icon={HardDrive}
          title="Accepted Audio Extensions"
          description="Control which file types the library watcher and sync jobs should treat as music."
        >
            <div className="flex flex-wrap gap-1.5">
              {audioExts.map((ext) => (
                <Badge key={ext} variant="secondary" className="text-xs gap-1 font-mono">
                  {ext}
                  <button onClick={() => removeExt(ext)} className="ml-0.5 hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input className="h-10 w-28" placeholder=".wav" value={newExt}
                onChange={(e) => setNewExt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addExt(); }} />
              <Button variant="outline" size="sm" onClick={addExt}>
                <Plus size={12} className="mr-1" /> Add
              </Button>
            </div>
        </PanelCard>
      </Section>
    </>
  );
}

// ── Notifications ──────────────────────────────────────────────

function NotificationsSection({ telegram, refetch }: { telegram?: SettingsData["telegram"]; refetch: () => void }) {
  const [enabled, setEnabled] = useState(telegram?.enabled ?? false);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(telegram?.chat_id ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEnabled(telegram?.enabled ?? false);
    setChatId(telegram?.chat_id ?? "");
  }, [telegram]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { enabled, chat_id: chatId };
      if (token) body.bot_token = token;
      await api("/api/settings/telegram", "PUT", body);
      toast.success("Telegram settings saved");
      setToken("");
      refetch();
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try {
      await api("/api/settings/telegram/test", "POST");
      toast.success("Test message sent");
    } catch { toast.error("Test failed"); }
    finally { setTesting(false); }
  }

  return (
    <Section title="Telegram Bot" description="Outbound operational notifications and test delivery.">
      <PanelCard
        icon={Bell}
        title="Telegram Notifications"
        description="Send task and system messages through a bot linked to your chat."
      >
          <FieldRow label="Enabled">
            <Toggle checked={enabled} onChange={setEnabled} />
            <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
              {enabled ? "Active" : "Disabled"}
            </Badge>
          </FieldRow>
          <FieldRow label="Bot Token">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={telegram?.has_token ? "Token configured" : "Paste from @BotFather"}
              className="max-w-sm"
            />
          </FieldRow>
          <FieldRow label="Chat ID">
            <Input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="Auto-filled on /start"
              className="max-w-sm"
            />
          </FieldRow>
          <div className="flex flex-wrap items-center gap-2 md:pl-[212px] pt-1">
            <Button onClick={save} disabled={saving} size="sm">
              {saving ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
              Save
            </Button>
            <Button onClick={test} disabled={testing || !telegram?.has_token} variant="outline" size="sm">
              {testing ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Wifi size={12} className="mr-1.5" />}
              Send Test
            </Button>
          </div>
          <p className="text-[10px] text-white/30 md:pl-[212px]">
            Create a bot via @BotFather, paste the token, then send /start to it.
          </p>
      </PanelCard>
    </Section>
  );
}

// ── Storage ────────────────────────────────────────────────────

function StorageSection({ dbStats }: { dbStats: Record<string, { size: number; rows: number }> }) {
  const [clearing, setClearing] = useState<string | null>(null);

  async function clearCache(type: string) {
    setClearing(type);
    try {
      await api("/api/settings/cache/clear", "POST", { type });
      toast.success(`Cache cleared: ${type}`);
    } catch { toast.error(`Failed to clear ${type}`); }
    finally { setClearing(null); }
  }

  const cacheActions = [
    { type: "all", label: "Clear All", variant: "destructive" as const },
    { type: "enrichment", label: "Enrichment", variant: "outline" as const },
    { type: "lastfm", label: "Last.fm", variant: "outline" as const },
    { type: "analytics", label: "Analytics", variant: "outline" as const },
  ];

  return (
    <>
      <Section title="Database" description="Table volume and on-disk footprint for the current instance.">
        <PanelCard
          icon={Database}
          title="Database Footprint"
          description="Row counts and size by table to spot growth and hot spots."
        >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] uppercase tracking-wider">Table</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">Rows</TableHead>
                  <TableHead className="text-right text-[10px] uppercase tracking-wider">Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(dbStats).map(([name, stats]) => (
                  <TableRow key={name} className="border-white/5">
                    <TableCell className="text-sm font-mono py-1.5">{name}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground py-1.5">
                      {stats.rows.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground py-1.5">
                      {formatBytes(stats.size)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
        </PanelCard>
      </Section>

      <Section title="Cache" description="Targeted eviction for stale derived data and remote metadata caches.">
        <PanelCard
          icon={Trash2}
          title="Cache Controls"
          description="Clear derived data without touching the underlying library."
        >
            <div className="flex gap-2 flex-wrap">
              {cacheActions.map(({ type, label, variant }) => (
                <Button key={type} variant={variant} size="sm" onClick={() => clearCache(type)} disabled={clearing !== null}>
                  {clearing === type
                    ? <Loader2 size={12} className="animate-spin mr-1.5" />
                    : <Trash2 size={12} className="mr-1.5" />
                  }
                  {label}
                </Button>
              ))}
            </div>
        </PanelCard>
      </Section>
    </>
  );
}

// ── Audit ──────────────────────────────────────────────────────

function AuditSection() {
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
        const res = await api<AuditResponse>(`/api/manage/audit-log?limit=${limit}&offset=${newOffset}${filterParam}`);
        if (reset) { setEntries(res.entries); setOffset(res.entries.length); }
        else { setEntries((prev) => [...prev, ...res.entries]); setOffset((prev) => prev + res.entries.length); }
        setTotal(res.total);
      } catch { toast.error("Failed to load audit log"); }
      finally { setLoading(false); }
    },
    [offset, actionFilter],
  );

  useEffect(() => { load(true); }, [actionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = [...new Set(entries.map((e) => e.action))].sort();

  return (
    <Section title="Audit Log" description="Operational history of changes, jobs and admin actions.">
      <PanelCard
        icon={ScrollText}
        title="Operational Timeline"
        description="Filter and inspect recent admin activity across the system."
      >
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs text-muted-foreground">
              {total > 0 ? `${total} entries` : ""}
            </span>
            <AdminSelect
              value={actionFilter}
              onChange={setActionFilter}
              options={[
                { value: "all", label: "All actions" },
                ...actions.map((action) => ({ value: action, label: action })),
              ]}
              placeholder="Filter actions"
              allowClear={false}
              triggerClassName="max-w-[220px]"
            />
          </div>

          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">No entries</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">Time</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Action</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Type</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id} className="border-white/5">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap py-1.5"
                        title={new Date(entry.timestamp).toLocaleString()}>
                        {formatTimestamp(entry.timestamp)}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge variant="outline" className="text-[10px] font-mono">{entry.action}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground py-1.5">{entry.target_type}</TableCell>
                      <TableCell className="text-sm max-w-[250px] truncate py-1.5">{entry.target_name}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {offset < total && (
                <div className="flex justify-center pt-4">
                  <Button variant="outline" size="sm" onClick={() => load(false)} disabled={loading}>
                    {loading && <Loader2 size={12} className="animate-spin mr-1.5" />}
                    Load More ({total - offset} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
      </PanelCard>
    </Section>
  );
}
