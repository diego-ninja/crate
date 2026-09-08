import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  GitMerge,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";

interface GlobalCatalogStatus {
  serving_mode:
    | "global-ready"
    | "global-refreshing"
    | "global-degraded"
    | "local-fallback";
  state: {
    status: string;
  };
  counts: {
    artists: number;
    albums: number;
    tracks: number;
    sources: number;
  };
  last_run?: GlobalCatalogRun | null;
  stale_peer_count: number;
  ambiguous_candidate_count: number;
}

interface GlobalCatalogRun {
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  completed_at?: string | null;
  source_rows_seen: number;
  sources_upserted: number;
  canonical_created: number;
  canonical_updated: number;
  error?: string | null;
}

interface DuplicateCandidate {
  entity_type: string;
  match_key: string;
  source_count: number;
  sources: Array<{
    source_kind: string;
    node_uid?: string | null;
    remote_entity_uid?: string | null;
    local_entity_uid?: string | null;
    global_entity_uid?: string | null;
    match_confidence?: number | null;
    match_method?: string | null;
  }>;
}

type Tab = "overview" | "runs" | "duplicates";

const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "runs", label: "Runs" },
  { key: "duplicates", label: "Duplicates" },
];

const numberFormatter = new Intl.NumberFormat();

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function formatNumber(value: number | undefined) {
  return numberFormatter.format(value || 0);
}

function servingModeLabel(mode?: GlobalCatalogStatus["serving_mode"]) {
  const labels: Record<GlobalCatalogStatus["serving_mode"], string> = {
    "global-ready": "Global ready",
    "global-refreshing": "Global refreshing",
    "global-degraded": "Global degraded",
    "local-fallback": "Local fallback",
  };
  return mode ? labels[mode] : "Unknown";
}

function servingModeDescription(mode?: GlobalCatalogStatus["serving_mode"]) {
  if (mode === "local-fallback") {
    return "First reconciliation in progress; local reads remain available.";
  }
  if (mode === "global-refreshing") {
    return "Reconciliation in progress; serving the last complete global catalog.";
  }
  if (mode === "global-degraded") {
    return "Reconciliation failed; serving the last complete global catalog.";
  }
  if (mode === "global-ready") {
    return "Serving the current complete global catalog.";
  }
  return "Catalog serving status is unavailable.";
}

export function GlobalCatalog() {
  const { hasAnyCapability } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [reconciling, setReconciling] = useState<"incremental" | "full" | null>(
    null,
  );
  const canManage = hasAnyCapability(["federation.policy.manage"]);
  const {
    data: status,
    loading,
    refetch: refetchStatus,
  } = useApi<GlobalCatalogStatus>("/api/admin/global-catalog/status");
  const { data: runs, refetch: refetchRuns } = useApi<{
    items: GlobalCatalogRun[];
  }>("/api/admin/global-catalog/runs?limit=25");
  const { data: duplicates } = useApi<{ items: DuplicateCandidate[] }>(
    "/api/admin/global-catalog/duplicates?limit=50",
  );

  async function queueReconcile(mode: "incremental" | "full") {
    setReconciling(mode);
    try {
      await api("/api/admin/global-catalog/reconcile", "POST", { mode });
      toast.success(
        mode === "full"
          ? "Full reconciliation queued"
          : "Incremental reconciliation queued",
      );
      await Promise.all([refetchStatus(), refetchRuns()]);
    } catch {
      toast.error("Failed to queue reconciliation");
    } finally {
      setReconciling(null);
    }
  }

  const counts = status?.counts;
  const runItems = runs?.items || [];
  const duplicateItems = duplicates?.items || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Global Catalog</h1>
          <p className="text-sm text-muted-foreground">
            Canonical deduped collection built from local library and trusted
            federated catalogs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refetchStatus()}
            disabled={loading}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            variant="outline"
            disabled={!canManage || reconciling !== null}
            onClick={() => void queueReconcile("incremental")}
          >
            {reconciling === "incremental" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <GitMerge className="mr-2 h-4 w-4" />
            )}
            Reconcile
          </Button>
          <Button
            disabled={!canManage || reconciling !== null}
            onClick={() => void queueReconcile("full")}
          >
            {reconciling === "full" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <DatabaseZap className="mr-2 h-4 w-4" />
            )}
            Full rebuild
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/10">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === item.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Artists" value={formatNumber(counts?.artists)} />
            <MetricCard label="Albums" value={formatNumber(counts?.albums)} />
            <MetricCard label="Tracks" value={formatNumber(counts?.tracks)} />
            <MetricCard
              label="Entity sources"
              value={formatNumber(counts?.sources)}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {status?.serving_mode === "global-degraded" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  )}
                  Read model
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge
                  variant={
                    status?.serving_mode === "global-ready"
                      ? "default"
                      : "secondary"
                  }
                >
                  {servingModeLabel(status?.serving_mode)}
                </Badge>
                <p className="text-muted-foreground">
                  {servingModeDescription(status?.serving_mode)}
                </p>
                <p className="text-muted-foreground">
                  Reconciliation state: {status?.state.status || "unknown"}
                </p>
                <p className="text-muted-foreground">
                  Stale peers: {formatNumber(status?.stale_peer_count)}
                </p>
                <p className="text-muted-foreground">
                  Unresolved match candidates:{" "}
                  {formatNumber(status?.ambiguous_candidate_count)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Similar sources below the automatic merge threshold; they
                  remain separate until reviewed.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Last run</CardTitle>
              </CardHeader>
              <CardContent>
                {status?.last_run ? (
                  <RunSummary run={status.last_run} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No reconciliation runs yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "runs" ? (
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation Runs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {runItems.length ? (
              runItems.map((run) => <RunSummary key={run.run_id} run={run} />)
            ) : (
              <p className="text-sm text-muted-foreground">No runs found.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "duplicates" ? (
        <Card>
          <CardHeader>
            <CardTitle>Duplicate Candidates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {duplicateItems.length ? (
              duplicateItems.map((candidate) => (
                <div
                  key={`${candidate.entity_type}-${candidate.match_key}`}
                  className="rounded-lg border border-white/10 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{candidate.entity_type}</Badge>
                    <span className="font-medium">{candidate.match_key}</span>
                    <span className="text-xs text-muted-foreground">
                      {candidate.source_count} sources
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {candidate.sources.map((source) => (
                      <div
                        key={`${source.source_kind}-${
                          source.node_uid ??
                          source.local_entity_uid ??
                          source.remote_entity_uid ??
                          source.global_entity_uid ??
                          source.match_method ??
                          "source"
                        }`}
                        className="rounded-md bg-white/[0.03] p-3 text-xs text-muted-foreground"
                      >
                        <div className="font-medium text-foreground">
                          {source.source_kind}
                        </div>
                        <div>{source.node_uid || source.local_entity_uid}</div>
                        <div>{source.match_method}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No duplicate candidates above the confidence threshold.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function RunSummary({ run }: { run: GlobalCatalogRun }) {
  return (
    <div className="rounded-lg border border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={run.status === "completed" ? "default" : "secondary"}>
            {run.status}
          </Badge>
          <span className="font-medium">{run.mode}</span>
          <span className="text-xs text-muted-foreground">{run.run_id}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDate(run.started_at)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-4">
        <span>Seen {formatNumber(run.source_rows_seen)}</span>
        <span>Upserted {formatNumber(run.sources_upserted)}</span>
        <span>Created {formatNumber(run.canonical_created)}</span>
        <span>Updated {formatNumber(run.canonical_updated)}</span>
      </div>
      {run.error ? (
        <p className="mt-3 text-sm text-red-300">{run.error}</p>
      ) : null}
    </div>
  );
}
