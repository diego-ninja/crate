import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Server,
  RefreshCw,
  ChevronUp,
  ScrollText,
  Loader2,
  Play,
  Square,
} from "lucide-react";

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string[];
}

interface StackStatus {
  available: boolean;
  total: number;
  running: number;
  containers: Container[];
}

interface ContainerLogs {
  name: string;
  logs: string;
}

const SERVICE_URLS: Record<string, string> = {
  lidarr: "https://collection.lespedants.org",
  tidarr: "https://search.lespedants.org",
  traefik: "https://traefik.lespedants.org",
  authelia: "https://auth.lespedants.org",
};

function stateColor(state: string): string {
  if (state === "running") return "text-green-500";
  if (state === "restarting") return "text-yellow-500";
  if (state === "exited" || state === "dead") return "text-red-500";
  return "text-muted-foreground";
}

function stateBg(state: string): string {
  if (state === "running") return "bg-green-500";
  if (state === "restarting") return "bg-yellow-500";
  return "bg-red-500";
}

export function Stack() {
  const [data, setData] = useState<StackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [restartTarget, setRestartTarget] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<ContainerLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const d = await api<StackStatus>("/api/stack/status");
      setData(d);
    } catch {
      setData({ available: false, total: 0, running: 0, containers: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 15000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  async function handleRestart(name: string) {
    setRestartTarget(null);
    setRestarting((s) => new Set(s).add(name));
    try {
      await api(`/api/stack/container/${name}/restart`, "POST");
      toast.success(`Restarting ${name}...`);
      setTimeout(fetchStatus, 3000);
    } catch {
      toast.error(`Failed to restart ${name}`);
    } finally {
      setRestarting((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
    }
  }

  async function handleToggle(name: string, currentState: string) {
    setRestarting((s) => new Set(s).add(name));
    const action = currentState === "running" ? "stop" : "start";
    try {
      await api(`/api/stack/container/${name}/${action}`, "POST");
      toast.success(`${action === "stop" ? "Stopping" : "Starting"} ${name}...`);
      setTimeout(fetchStatus, 2000);
    } catch {
      toast.error(`Failed to ${action} ${name}`);
    } finally {
      setRestarting((s) => {
        const next = new Set(s);
        next.delete(name);
        return next;
      });
    }
  }

  async function toggleLogs(name: string) {
    if (expandedLogs === name) {
      setExpandedLogs(null);
      setLogs(null);
      return;
    }
    setExpandedLogs(name);
    setLogsLoading(true);
    try {
      const d = await api<ContainerLogs>(`/api/stack/container/${name}/logs?tail=30`);
      setLogs(d);
    } catch {
      setLogs({ name, logs: "Failed to load logs" });
    } finally {
      setLogsLoading(false);
    }
  }

  const running = data?.containers.filter((c) => c.state === "running") ?? [];
  const stopped = data?.containers.filter((c) => c.state !== "running") ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Crate Stack</h1>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStatus}>
          <RefreshCw size={14} className="mr-1" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="animate-spin mr-2" /> Loading stack status...
        </div>
      ) : !data?.available ? (
        <Card className="bg-card">
          <CardContent className="py-8 text-center text-muted-foreground">
            Docker socket not available. Mount /var/run/docker.sock in the API container.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <Card className="bg-card border-l-4 border-l-green-500">
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{data.running}</div>
                <div className="text-xs text-muted-foreground">Running</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-l-4 border-l-red-500">
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{data.total - data.running}</div>
                <div className="text-xs text-muted-foreground">Stopped</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-l-4 border-l-blue-500">
              <CardContent className="pt-6">
                <div className="text-2xl font-bold">{data.total}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </CardContent>
            </Card>
          </div>

          {/* Running containers */}
          <div className="space-y-2 mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Running ({running.length})
            </h2>
            {running.map((c) => (
              <ContainerRow
                key={c.id}
                container={c}
                isRestarting={restarting.has(c.name)}
                isLogsExpanded={expandedLogs === c.name}
                logs={expandedLogs === c.name ? logs : null}
                logsLoading={expandedLogs === c.name && logsLoading}
                onRestart={() => setRestartTarget(c.name)}
                onToggleState={() => handleToggle(c.name, c.state)}
                onToggleLogs={() => toggleLogs(c.name)}
              />
            ))}
          </div>

          {/* Stopped containers */}
          {stopped.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Stopped ({stopped.length})
              </h2>
              {stopped.map((c) => (
                <ContainerRow
                  key={c.id}
                  container={c}
                  isRestarting={restarting.has(c.name)}
                  isLogsExpanded={expandedLogs === c.name}
                  logs={expandedLogs === c.name ? logs : null}
                  logsLoading={expandedLogs === c.name && logsLoading}
                  onRestart={() => setRestartTarget(c.name)}
                  onToggleState={() => handleToggle(c.name, c.state)}
                  onToggleLogs={() => toggleLogs(c.name)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={restartTarget !== null}
        onOpenChange={(open) => { if (!open) setRestartTarget(null); }}
        title="Restart Container"
        description={`Are you sure you want to restart ${restartTarget}?`}
        confirmLabel="Restart"
        variant="destructive"
        onConfirm={() => restartTarget && handleRestart(restartTarget)}
      />
    </div>
  );
}

function ContainerRow({
  container: c,
  isRestarting,
  isLogsExpanded,
  logs,
  logsLoading,
  onRestart,
  onToggleState,
  onToggleLogs,
}: {
  container: Container;
  isRestarting: boolean;
  isLogsExpanded: boolean;
  logs: ContainerLogs | null;
  logsLoading: boolean;
  onRestart: () => void;
  onToggleState: () => void;
  onToggleLogs: () => void;
}) {
  const isRunning = c.state === "running";
  const serviceUrl = SERVICE_URLS[c.name];

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-3">
        {/* Status dot */}
        <div className={`w-2.5 h-2.5 rounded-full ${stateBg(c.state)} flex-shrink-0`} />

        {/* Name + image */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{c.name}</span>
            {serviceUrl && (
              <a
                href={serviceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-primary hover:underline"
              >
                {new URL(serviceUrl).hostname}
              </a>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {c.image.split("@")[0]}
          </div>
        </div>

        {/* Status */}
        <div className="text-right flex-shrink-0">
          <Badge variant="outline" className={`text-[10px] ${stateColor(c.state)}`}>
            {c.status}
          </Badge>
        </div>

        {/* Ports */}
        {c.ports.length > 0 && (
          <div className="text-xs text-muted-foreground flex-shrink-0 hidden sm:block">
            {c.ports.join(", ")}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleLogs}
            title="Logs"
          >
            {isLogsExpanded ? <ChevronUp size={14} /> : <ScrollText size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${isRunning ? "text-muted-foreground hover:text-red-500" : "text-muted-foreground hover:text-green-500"}`}
            onClick={onToggleState}
            disabled={isRestarting}
            title={isRunning ? "Stop" : "Start"}
          >
            {isRestarting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isRunning ? (
              <Square size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
          </Button>
          {isRunning && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-yellow-500"
              onClick={onRestart}
              disabled={isRestarting}
              title="Restart"
            >
              <RefreshCw size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded logs */}
      {isLogsExpanded && (
        <div className="border-t border-border bg-[#060608] px-4 py-3 max-h-[350px] overflow-auto scroll-smooth">
          {logsLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 size={12} className="animate-spin" /> Loading logs...
            </div>
          ) : logs?.logs ? (
            <div className="font-mono text-[11px] leading-[1.7] space-y-px">
              {logs.logs.split("\n").filter(Boolean).map((line, i) => (
                <LogLine key={i} line={line} />
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-4">No logs available</div>
          )}
        </div>
      )}
    </div>
  );
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: "text-red-400",
  fatal: "text-red-400",
  warn: "text-yellow-400",
  warning: "text-yellow-400",
  info: "text-blue-400",
  debug: "text-white/30",
  trace: "text-white/20",
};

function LogLine({ line }: { line: string }) {
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^ ]*)\s*/);
  const goTsMatch = !tsMatch ? line.match(/^(time="[^"]+")/) : null;

  const levelMatch = line.match(/\b(?:level=|\[)(error|fatal|warn(?:ing)?|info|debug|trace)\b/i);
  const level = levelMatch?.[1]?.toLowerCase() ?? null;
  const levelColor = (level && LOG_LEVEL_COLORS[level]) || "text-white/50";

  let timestamp = "";
  let rest = line;

  if (tsMatch) {
    timestamp = tsMatch[1] ?? "";
    rest = line.slice(tsMatch[0]?.length ?? 0);
  } else if (goTsMatch) {
    const inner = goTsMatch[1]?.match(/time="([^"]+)"/);
    timestamp = inner?.[1] ?? goTsMatch[1] ?? "";
    rest = line.slice(goTsMatch[0]?.length ?? 0);
  }

  const parts = rest.split(/((?:msg|method|status|path|elapsed|count|error|client|username|requestId)="[^"]*"|(?:msg|method|status|path|elapsed|count|error)=[^\s]+)/g);

  return (
    <div className={`flex gap-0 py-px hover:bg-white/[0.02] rounded px-1 ${level === "error" || level === "fatal" ? "bg-red-500/5" : ""}`}>
      {timestamp && (
        <span className="text-white/20 flex-shrink-0 w-[80px] mr-3 select-none tabular-nums">{formatLogTs(timestamp)}</span>
      )}
      {level && (
        <span className={`flex-shrink-0 w-[40px] mr-2 font-semibold uppercase text-[10px] leading-[1.7] ${levelColor}`}>
          {level.slice(0, 5)}
        </span>
      )}
      <span className={`flex-1 break-all ${level === "debug" || level === "trace" ? "text-white/30" : "text-white/60"}`}>
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <span key={i} className="text-primary/60">{part}</span>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    </div>
  );
}

function formatLogTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts.slice(11, 19);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}
