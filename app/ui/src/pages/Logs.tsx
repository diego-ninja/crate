import { useCallback, useEffect, useState } from "react";
import { ScrollText, RefreshCw, Filter } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

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

const LEVEL_STYLES: Record<string, { dot: string; text: string }> = {
  error: { dot: "bg-red-400", text: "text-red-300" },
  warn: { dot: "bg-amber-400", text: "text-amber-300" },
  info: { dot: "bg-emerald-400", text: "text-white/70" },
  debug: { dot: "bg-white/30", text: "text-white/50" },
};

const CATEGORIES = ["general", "enrichment", "analysis", "tidal", "sync", "system"];

export function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [workerId, setWorkerId] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (level) params.set("level", level);
      if (category) params.set("category", category);
      if (workerId) params.set("worker_id", workerId);
      const data = await api<LogEntry[]>(`/api/admin/logs?${params}`);
      setLogs(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [level, category, workerId]);

  const fetchWorkers = useCallback(async () => {
    try {
      const data = await api<WorkerInfo[]>("/api/admin/logs/workers");
      setWorkers(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchWorkers();
  }, [fetchLogs, fetchWorkers]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Worker Logs</h1>
          {autoRefresh && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300 text-[10px]">
              Live
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "border-emerald-400/30 text-emerald-300" : ""}
          >
            {autoRefresh ? "Pause" : "Resume"}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter size={14} className="text-white/40" />
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="">All levels</option>
          <option value="error">Error</option>
          <option value="warn">Warning</option>
          <option value="info">Info</option>
          <option value="debug">Debug</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground"
        >
          <option value="">All workers</option>
          {workers.map((w) => (
            <option key={w.worker_id} value={w.worker_id}>{w.worker_id}</option>
          ))}
        </select>
        {(level || category || workerId) && (
          <button
            onClick={() => { setLevel(""); setCategory(""); setWorkerId(""); }}
            className="text-xs text-white/40 hover:text-white/70"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Log entries */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            No log entries found
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[calc(100vh-240px)] overflow-y-auto">
            {logs.map((entry) => {
              const style = LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.info!;
              return (
                <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02]">
                  <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${style.text}`}>
                      {entry.message}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-white/35">
                      <span>{timeAgo(entry.created_at)}</span>
                      <span className="text-white/20">·</span>
                      <span>{entry.category}</span>
                      {entry.task_id && (
                        <>
                          <span className="text-white/20">·</span>
                          <a
                            href={`/tasks?task=${entry.task_id}`}
                            className="font-mono text-primary/60 hover:text-primary"
                          >
                            {entry.task_id.slice(0, 8)}
                          </a>
                        </>
                      )}
                      <span className="text-white/20">·</span>
                      <span className="font-mono">{entry.worker_id}</span>
                    </div>
                    {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                      <div className="mt-1 text-[10px] text-white/25 font-mono truncate">
                        {JSON.stringify(entry.metadata)}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="flex-shrink-0 text-[9px] px-1.5 py-0">
                    {entry.level}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
