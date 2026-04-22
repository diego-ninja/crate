import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  AlertTriangle,
  Bug,
  Filter,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Wifi,
} from "lucide-react";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@/components/ui/CrateBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/error-state";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

interface LogEntry {
  id: number;
  worker_id: string;
  task_id: string | null;
  level: string;
  category: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface WorkerInfo {
  worker_id: string;
  last_seen: string;
  log_count: number;
}

const KNOWN_CATEGORIES = ["general", "enrichment", "analysis", "tidal", "sync", "system"];

const LEVEL_META: Record<string, { dot: string; text: string; pill: string }> = {
  error: {
    dot: "bg-red-400",
    text: "text-red-100",
    pill: "border-red-500/25 bg-red-500/10 text-red-100",
  },
  warn: {
    dot: "bg-amber-400",
    text: "text-amber-100",
    pill: "border-amber-500/25 bg-amber-500/10 text-amber-100",
  },
  info: {
    dot: "bg-cyan-400",
    text: "text-white/80",
    pill: "border-cyan-400/25 bg-cyan-400/10 text-cyan-100",
  },
  debug: {
    dot: "bg-white/25",
    text: "text-white/55",
    pill: "border-white/10 bg-white/[0.04] text-white/55",
  },
};

function formatLogTimestamp(ts: string) {
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts;
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function isWorkerOnline(lastSeen: string) {
  const ts = new Date(lastSeen).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts <= 5 * 60 * 1000;
}

function metadataPreview(metadata: Record<string, unknown> | null) {
  if (!metadata || Object.keys(metadata).length === 0) return "";
  return JSON.stringify(metadata);
}

function WorkerTile({
  worker,
  active,
  onClick,
}: {
  worker: WorkerInfo;
  active: boolean;
  onClick: () => void;
}) {
  const online = isWorkerOnline(worker.last_seen);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border bg-black/20 p-3 text-left transition-colors",
        active ? "border-cyan-400/25 bg-cyan-400/10" : "border-white/8 hover:border-white/16 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-medium text-white">{worker.worker_id}</div>
          <div className="text-xs text-white/40">{worker.log_count} log lines seen</div>
        </div>
        <CrateChip className={online ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : ""}>
          {online ? "Online" : "Idle"}
        </CrateChip>
      </div>
      <div className="mt-3 text-xs text-white/35">Last seen {timeAgo(worker.last_seen)}</div>
    </button>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const level = entry.level.toLowerCase();
  const meta = LEVEL_META[level] ?? LEVEL_META.info!;
  const metadata = metadataPreview(entry.metadata);

  return (
    <div className={cn("grid gap-3 border-b border-white/6 px-4 py-3 font-mono text-[11px] transition-colors hover:bg-white/[0.03] md:grid-cols-[78px_68px_minmax(0,1fr)]", level === "error" && "bg-red-500/[0.04]")}>
      <div className="text-white/25 tabular-nums">{formatLogTimestamp(entry.created_at)}</div>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
        <span className={cn("uppercase tracking-[0.12em]", meta.text)}>{level}</span>
      </div>
      <div className="min-w-0 space-y-1">
        <div className={cn("break-words leading-5", meta.text)}>{entry.message}</div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-white/35">
          <CrateChip className="font-sans">{entry.category}</CrateChip>
          <CrateChip className="font-sans">{entry.worker_id}</CrateChip>
          {entry.task_id ? (
            <Link to={`/tasks?task=${entry.task_id}`} className="font-sans text-primary/70 hover:text-primary">
              Task {entry.task_id.slice(0, 8)}
            </Link>
          ) : null}
          <span>{timeAgo(entry.created_at)}</span>
        </div>
        {metadata ? (
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-white/30">
            {metadata}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (workerId) params.set("worker_id", workerId);
      const data = await api<LogEntry[]>(`/api/admin/logs?${params.toString()}`);
      setLogs(data);
      setError(null);
    } catch {
      setError("Failed to load worker logs");
    } finally {
      setLoading(false);
    }
  }, [level, category, workerId]);

  const fetchWorkers = useCallback(async () => {
    try {
      const data = await api<WorkerInfo[]>("/api/admin/logs/workers");
      setWorkers(data);
    } catch {
      // Worker list is secondary; leave page usable without it.
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchWorkers();
  }, [fetchLogs, fetchWorkers]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => fetchLogs(true), 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const categories = useMemo(() => {
    const dynamic = new Set(logs.map((entry) => entry.category).filter(Boolean));
    for (const categoryName of KNOWN_CATEGORIES) dynamic.add(categoryName);
    return [...dynamic].sort((a, b) => a.localeCompare(b));
  }, [logs]);

  const visibleLogs = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return logs;

    return logs.filter((entry) => {
      const metadata = metadataPreview(entry.metadata).toLowerCase();
      const haystack = `${entry.message} ${entry.category} ${entry.worker_id} ${entry.task_id ?? ""} ${metadata}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [logs, search]);

  const summary = useMemo(() => {
    const errors = visibleLogs.filter((entry) => entry.level === "error").length;
    const warnings = visibleLogs.filter((entry) => entry.level === "warn").length;
    const infos = visibleLogs.filter((entry) => entry.level === "info").length;
    const onlineWorkers = workers.filter((worker) => isWorkerOnline(worker.last_seen)).length;
    return { errors, warnings, infos, onlineWorkers };
  }, [visibleLogs, workers]);

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error && logs.length === 0) {
    return <ErrorState message={error} onRetry={() => fetchLogs()} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={ScrollText}
        title="Logs"
        description="Live worker stream for enrichment, analysis, sync and system activity. Built for triage, not archaeology."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setAutoRefresh((current) => !current)}
            >
              {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
              {autoRefresh ? "Pause live" : "Resume live"}
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => fetchLogs()}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </>
        }
      >
        <CratePill active icon={ScrollText}>{visibleLogs.length} lines</CratePill>
        <CratePill icon={Wifi}>{summary.onlineWorkers}/{workers.length} workers online</CratePill>
        {summary.errors > 0 ? <CratePill className="border-red-500/25 bg-red-500/10 text-red-100">{summary.errors} errors</CratePill> : null}
        {summary.warnings > 0 ? <CratePill className="border-amber-500/25 bg-amber-500/10 text-amber-100">{summary.warnings} warnings</CratePill> : null}
        <CratePill>{autoRefresh ? "Live mode" : "Frozen snapshot"}</CratePill>
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile icon={ShieldAlert} label="Errors" value={summary.errors.toLocaleString()} caption="Filtered lines at error level" tone={summary.errors > 0 ? "danger" : "default"} />
        <OpsStatTile icon={AlertTriangle} label="Warnings" value={summary.warnings.toLocaleString()} caption="Things worth checking before they hard-fail" tone={summary.warnings > 0 ? "warning" : "default"} />
        <OpsStatTile icon={Wifi} label="Workers online" value={summary.onlineWorkers.toLocaleString()} caption={`${workers.length.toLocaleString()} known workers`} tone={summary.onlineWorkers > 0 ? "success" : "default"} />
        <OpsStatTile icon={Bug} label="Info / debug" value={(summary.infos + visibleLogs.filter((entry) => entry.level === "debug").length).toLocaleString()} caption="Operational noise still visible in the stream" />
      </div>

      <OpsPanel
        icon={Filter}
        title="Filters"
        description="Shape the stream by severity, worker, category or free-text search without losing the live console feel."
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages, workers, task ids or metadata..."
              className="pl-9"
            />
          </div>
          <AdminSelect
            value={level}
            onChange={setLevel}
            placeholder="All levels"
            options={[
              { value: "error", label: "Error" },
              { value: "warn", label: "Warning" },
              { value: "info", label: "Info" },
              { value: "debug", label: "Debug" },
            ]}
          />
          <AdminSelect
            value={category}
            onChange={setCategory}
            placeholder="All categories"
            options={categories.map((entry) => ({ value: entry, label: entry }))}
            searchable
            searchPlaceholder="Filter categories..."
          />
          <AdminSelect
            value={workerId}
            onChange={setWorkerId}
            placeholder="All workers"
            options={workers.map((worker) => ({
              value: worker.worker_id,
              label: worker.worker_id,
              count: worker.log_count,
            }))}
            searchable
            searchPlaceholder="Filter workers..."
          />
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Wifi}
        title="Worker roster"
        description="Known workers, their recent heartbeat, and a quick way to isolate one noisy process from the rest."
      >
        {workers.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {workers.map((worker) => (
              <WorkerTile
                key={worker.worker_id}
                worker={worker}
                active={workerId === worker.worker_id}
                onClick={() => setWorkerId((current) => current === worker.worker_id ? "" : worker.worker_id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-8 text-center text-sm text-white/35">
            No worker heartbeat data available yet.
          </div>
        )}
      </OpsPanel>

      <OpsPanel
        icon={ScrollText}
        title="Incident stream"
        description="Newest lines first. The console stays readable even when filtered down to one worker or one category."
      >
        <div className="overflow-hidden rounded-md border border-white/8 bg-[#06080c]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/6 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {level ? <CrateChip className={LEVEL_META[level]?.pill}>{level}</CrateChip> : null}
              {category ? <CrateChip>{category}</CrateChip> : null}
              {workerId ? <CrateChip>{workerId}</CrateChip> : null}
              {search ? <CrateChip>{search}</CrateChip> : null}
              {!level && !category && !workerId && !search ? <CrateChip>All filters open</CrateChip> : null}
            </div>
            <div className="text-xs text-white/35">
              Showing {visibleLogs.length} of {logs.length} lines
            </div>
          </div>

          {visibleLogs.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-white/40">
              No log lines match the current filters.
            </div>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {visibleLogs.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </OpsPanel>
    </div>
  );
}
