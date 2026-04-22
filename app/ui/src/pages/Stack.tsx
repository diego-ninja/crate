import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Square,
  ScrollText,
  Search,
  RotateCcw,
  Wifi,
  AlertTriangle,
  Package,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@crate/ui/shadcn/input";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { Button } from "@crate/ui/shadcn/button";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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

type ServiceFilter = "all" | "running" | "stopped";

const SERVICE_URLS: Record<string, string> = {
  lidarr: "https://collection.lespedants.org",
  tidarr: "https://search.lespedants.org",
  traefik: "https://traefik.lespedants.org",
  authelia: "https://auth.lespedants.org",
};

const STATE_STYLES: Record<string, { chip: string; dot: string; tone: "default" | "success" | "warning" | "danger" }> = {
  running: {
    chip: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    dot: "bg-emerald-400",
    tone: "success",
  },
  restarting: {
    chip: "border-amber-500/25 bg-amber-500/10 text-amber-100",
    dot: "bg-amber-400",
    tone: "warning",
  },
  exited: {
    chip: "border-red-500/25 bg-red-500/10 text-red-100",
    dot: "bg-red-400",
    tone: "danger",
  },
  dead: {
    chip: "border-red-500/25 bg-red-500/10 text-red-100",
    dot: "bg-red-400",
    tone: "danger",
  },
};

function getServiceUrl(name: string) {
  return SERVICE_URLS[name];
}

function serviceHostname(name: string) {
  const url = getServiceUrl(name);
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function displayImage(image: string) {
  return image.split("@")[0] || image;
}

function formatLogTimestamp(line: string) {
  const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^ ]*)\s*/);
  if (tsMatch?.[1]) {
    const date = new Date(tsMatch[1]);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return tsMatch[1];
  }

  const goTsMatch = line.match(/time="([^"]+)"/);
  if (goTsMatch?.[1]) {
    const date = new Date(goTsMatch[1]);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
    return goTsMatch[1];
  }

  return "";
}

function stateMeta(state: string) {
  return STATE_STYLES[state] ?? {
    chip: "border-white/10 bg-white/[0.04] text-white/60",
    dot: "bg-white/35",
    tone: "default" as const,
  };
}

function StackLogLine({ line }: { line: string }) {
  const timestamp = formatLogTimestamp(line);

  return (
    <div className="flex gap-3 rounded-sm px-2 py-1 font-mono text-[11px] text-white/60 hover:bg-white/[0.03]">
      {timestamp ? <span className="w-[78px] shrink-0 text-white/20 tabular-nums">{timestamp}</span> : null}
      <span className="min-w-0 flex-1 break-all">{line}</span>
    </div>
  );
}

function ServiceCard({
  container,
  expanded,
  logs,
  logsLoading,
  busy,
  onToggleLogs,
  onRestart,
  onToggleState,
}: {
  container: Container;
  expanded: boolean;
  logs: ContainerLogs | null;
  logsLoading: boolean;
  busy: boolean;
  onToggleLogs: () => void;
  onRestart: () => void;
  onToggleState: () => void;
}) {
  const isRunning = container.state === "running";
  const serviceUrl = getServiceUrl(container.name);
  const hostname = serviceHostname(container.name);
  const state = stateMeta(container.state);

  return (
    <div className="overflow-hidden rounded-md border border-white/8 bg-black/20 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold tracking-tight text-white">{container.name}</span>
              <CrateChip className={state.chip}>
                <span className={cn("h-2 w-2 rounded-full", state.dot)} />
                {container.state}
              </CrateChip>
              {hostname ? <CrateChip>{hostname}</CrateChip> : null}
            </div>
            <div className="text-sm text-white/40">{displayImage(container.image)}</div>
          </div>

          <div className="flex items-center gap-1">
            <ActionIconButton variant="card" onClick={onToggleLogs} title={expanded ? "Hide logs" : "Show logs"}>
              <ScrollText size={15} />
            </ActionIconButton>
            <ActionIconButton
              variant="card"
              tone={isRunning ? "danger" : "primary"}
              onClick={onToggleState}
              disabled={busy}
              title={isRunning ? "Stop service" : "Start service"}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : isRunning ? <Square size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </ActionIconButton>
            <ActionIconButton
              variant="card"
              tone="default"
              onClick={onRestart}
              disabled={busy || !isRunning}
              title="Restart service"
            >
              <RotateCcw size={15} />
            </ActionIconButton>
            {serviceUrl ? (
              <a
                href={serviceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/55 text-white/45 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-colors hover:bg-black/70 hover:text-white"
                title="Open service"
              >
                <ExternalLink size={15} />
              </a>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-sm border border-white/6 bg-black/15 p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">Status</div>
            <div className="mt-1 text-sm font-medium text-white/85">{container.status}</div>
          </div>
          <div className="rounded-sm border border-white/6 bg-black/15 p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">Ports</div>
            <div className="mt-1 text-sm font-medium text-white/85">{container.ports.length > 0 ? container.ports.join(", ") : "No exposed ports"}</div>
          </div>
          <div className="rounded-sm border border-white/6 bg-black/15 p-3">
            <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">Public route</div>
            <div className="mt-1 text-sm font-medium text-white/85">{hostname ?? "Internal only"}</div>
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-white/8 bg-[#06080c] px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-white">Recent logs</div>
            <CrateChip>{container.name}</CrateChip>
          </div>
          {logsLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-white/45">
              <Loader2 size={14} className="animate-spin text-primary" />
              Loading service logs…
            </div>
          ) : logs?.logs ? (
            <div className="max-h-[320px] overflow-y-auto rounded-sm border border-white/6 bg-black/20 py-2">
              {logs.logs.split("\n").filter(Boolean).map((line, index) => (
                <StackLogLine key={`${container.name}-${index}`} line={line} />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-6 text-sm text-white/35">
              No logs available for this service.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Stack() {
  const [data, setData] = useState<StackStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ServiceFilter>("all");
  const [restartTarget, setRestartTarget] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<Set<string>>(new Set());
  const [expandedLogs, setExpandedLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<ContainerLogs | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await api<StackStatus>("/api/stack/status");
      setData(response);
      setError(null);
    } catch {
      setError("Failed to load Docker stack status");
      setData({ available: false, total: 0, running: 0, containers: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(() => fetchStatus(true), 15000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  async function handleRestart(name: string) {
    setRestartTarget(null);
    setRestarting((current) => new Set(current).add(name));
    try {
      await api(`/api/stack/container/${name}/restart`, "POST");
      toast.success(`Restarting ${name}…`);
      setTimeout(() => fetchStatus(true), 2500);
    } catch {
      toast.error(`Failed to restart ${name}`);
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
        next.delete(name);
        return next;
      });
    }
  }

  async function handleToggleState(name: string, currentState: string) {
    const action = currentState === "running" ? "stop" : "start";
    setRestarting((current) => new Set(current).add(name));
    try {
      await api(`/api/stack/container/${name}/${action}`, "POST");
      toast.success(`${action === "stop" ? "Stopping" : "Starting"} ${name}…`);
      setTimeout(() => fetchStatus(true), 2000);
    } catch {
      toast.error(`Failed to ${action} ${name}`);
    } finally {
      setRestarting((current) => {
        const next = new Set(current);
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
      const response = await api<ContainerLogs>(`/api/stack/container/${name}/logs?tail=30`);
      setLogs(response);
    } catch {
      setLogs({ name, logs: "" });
    } finally {
      setLogsLoading(false);
    }
  }

  const filteredContainers = useMemo(() => {
    const containers = data?.containers ?? [];
    const normalized = search.trim().toLowerCase();

    return containers.filter((container) => {
      if (filter === "running" && container.state !== "running") return false;
      if (filter === "stopped" && container.state === "running") return false;
      if (!normalized) return true;
      const haystack = `${container.name} ${container.image} ${container.status} ${container.ports.join(" ")}`.toLowerCase();
      return haystack.includes(normalized);
    }).sort((a, b) => {
      if (a.state === "running" && b.state !== "running") return -1;
      if (a.state !== "running" && b.state === "running") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [data?.containers, filter, search]);

  const publicRoutes = useMemo(
    () => (data?.containers ?? []).filter((container) => Boolean(getServiceUrl(container.name))).length,
    [data?.containers],
  );

  if (loading && !data) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState message={error} onRetry={() => fetchStatus()} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Server}
        title="Stack"
        description="Managed Docker services, their runtime state, and the quickest path to logs or restart when the platform starts wobbling."
        actions={
          <Button variant="outline" size="sm" className="gap-2" onClick={() => fetchStatus()}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        }
      >
        <CratePill active icon={Server}>{data?.running ?? 0}/{data?.total ?? 0} running</CratePill>
        <CratePill icon={Wifi}>{publicRoutes} public routes</CratePill>
        <CratePill>{data?.available ? "Docker available" : "Docker unavailable"}</CratePill>
      </OpsPageHero>

      {!data?.available ? (
        <OpsPanel
          icon={AlertTriangle}
          title="Docker not available"
          description="The API container cannot see the Docker socket, so stack inspection and service controls are disabled."
        >
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-8 text-center text-sm text-white/35">
            Mount <code className="rounded-sm bg-white/[0.05] px-1.5 py-0.5 text-white/65">/var/run/docker.sock</code> into the API container to restore stack operations.
          </div>
        </OpsPanel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OpsStatTile icon={Server} label="Running services" value={(data?.running ?? 0).toLocaleString()} caption={`${data?.total ?? 0} managed containers`} tone={(data?.running ?? 0) > 0 ? "success" : "default"} />
            <OpsStatTile icon={Square} label="Stopped services" value={((data?.total ?? 0) - (data?.running ?? 0)).toLocaleString()} caption="Exited or unavailable containers" tone={((data?.total ?? 0) - (data?.running ?? 0)) > 0 ? "warning" : "default"} />
            <OpsStatTile icon={ExternalLink} label="Public routes" value={publicRoutes.toLocaleString()} caption="Services with an external URL shortcut" />
            <OpsStatTile icon={Package} label="Visible services" value={filteredContainers.length.toLocaleString()} caption="Current filtered result set" />
          </div>

          <OpsPanel
            icon={Search}
            title="Service filters"
            description="Trim the board by runtime state or by service name, image and port text."
          >
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative flex-1 min-w-[240px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search services, images or ports..."
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CratePill active={filter === "all"} onClick={() => setFilter("all")}>All</CratePill>
                <CratePill active={filter === "running"} onClick={() => setFilter("running")}>Running</CratePill>
                <CratePill active={filter === "stopped"} onClick={() => setFilter("stopped")}>Stopped</CratePill>
              </div>
            </div>
          </OpsPanel>

          <OpsPanel
            icon={Server}
            title="Services"
            description="Service cards keep control actions close to state, while logs expand inline only when you need more detail."
          >
            {filteredContainers.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredContainers.map((container) => (
                  <ServiceCard
                    key={container.id}
                    container={container}
                    expanded={expandedLogs === container.name}
                    logs={expandedLogs === container.name ? logs : null}
                    logsLoading={expandedLogs === container.name && logsLoading}
                    busy={restarting.has(container.name)}
                    onToggleLogs={() => toggleLogs(container.name)}
                    onRestart={() => setRestartTarget(container.name)}
                    onToggleState={() => handleToggleState(container.name, container.state)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-8 text-center text-sm text-white/35">
                No services match the current filters.
              </div>
            )}
          </OpsPanel>
        </>
      )}

      <ConfirmDialog
        open={restartTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestartTarget(null);
        }}
        title="Restart service"
        description={`Restart ${restartTarget}? This interrupts the container and may briefly affect admin or listener traffic.`}
        confirmLabel="Restart"
        variant="destructive"
        onConfirm={() => restartTarget && handleRestart(restartTarget)}
      />
    </div>
  );
}
