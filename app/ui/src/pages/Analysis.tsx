import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AudioWaveform,
  Gauge,
  Loader2,
  Music,
  RefreshCw,
  Sparkles,
  Waves,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { CrateChip, CratePill } from "@crate-ui/primitives/CrateBadge";
import { Button } from "@crate-ui/shadcn/button";
import { ErrorState } from "@crate-ui/primitives/ErrorState";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AnalysisStatus {
  total: number;
  analysis_done: number;
  analysis_pending: number;
  analysis_active: number;
  analysis_failed: number;
  bliss_done: number;
  bliss_pending: number;
  bliss_active: number;
  bliss_failed: number;
  last_analyzed: {
    title?: string;
    artist?: string;
    album?: string;
    bpm?: number;
    audio_key?: string;
    energy?: number;
    danceability?: number;
    has_mood?: boolean;
    updated_at?: string;
  };
  last_bliss: {
    title?: string;
    artist?: string;
    album?: string;
    updated_at?: string;
  };
}

type ActionKey = "analysis" | "bliss" | "popularity" | null;

function formatPercent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function formatTimestamp(value?: string) {
  if (!value) return "No recent activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  return date.toLocaleString();
}

function PipelineCoverage({
  icon: Icon,
  title,
  done,
  pending,
  active,
  failed,
  total,
  accentClassName,
  emptyLabel,
}: {
  icon: typeof Music;
  title: string;
  done: number;
  pending: number;
  active: number;
  failed: number;
  total: number;
  accentClassName: string;
  emptyLabel: string;
}) {
  const percent = formatPercent(done, total);
  const blocked = failed > 0;

  return (
    <div className="rounded-md border border-white/8 bg-black/20 p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05]", accentClassName)}>
            <Icon size={16} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium text-white">{title}</div>
            <div className="text-xs text-white/40">
              {total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()} tracks processed` : emptyLabel}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CrateChip className="text-[10px]">{percent}% coverage</CrateChip>
          {active > 0 ? <CrateChip active>{active} active</CrateChip> : null}
          {failed > 0 ? <CrateChip className="border-red-500/25 bg-red-500/10 text-red-200">{failed} failed</CrateChip> : null}
        </div>
      </div>

      <div className="space-y-3">
        <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
          <div
            className={cn("h-full rounded-sm transition-all duration-500", blocked ? "bg-gradient-to-r from-red-500/60 to-amber-400/70" : accentClassName.replace("text-", "bg-").replace("/80", ""))}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-4">
          <MiniMetric label="Done" value={done.toLocaleString()} />
          <MiniMetric label="Pending" value={pending.toLocaleString()} />
          <MiniMetric label="Active" value={active.toLocaleString()} />
          <MiniMetric label="Failed" value={failed.toLocaleString()} tone={failed > 0 ? "danger" : "muted"} />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "danger";
}) {
  return (
    <div className="rounded-sm border border-white/6 bg-black/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">{label}</div>
      <div className={cn("mt-1 text-sm font-medium", tone === "danger" ? "text-red-200" : tone === "muted" ? "text-white/55" : "text-white/85")}>
        {value}
      </div>
    </div>
  );
}

function RecentTrackCard({
  icon: Icon,
  title,
  track,
}: {
  icon: typeof Activity;
  title: string;
  track: AnalysisStatus["last_analyzed"] | AnalysisStatus["last_bliss"];
}) {
  return (
    <div className="rounded-md border border-white/8 bg-black/20 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-white/70">
          <Icon size={16} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="text-xs text-white/40">{formatTimestamp(track.updated_at)}</div>
        </div>
      </div>

      {track.title ? (
        <div className="space-y-3">
          <div>
            <div className="text-base font-semibold tracking-tight text-white">{track.title}</div>
            <div className="text-sm text-white/45">
              {track.artist || "Unknown artist"}
              {track.album ? ` · ${track.album}` : ""}
            </div>
          </div>

          {"bpm" in track ? (
            <div className="flex flex-wrap gap-2">
              {track.bpm != null ? <CrateChip>{Math.round(track.bpm)} BPM</CrateChip> : null}
              {"audio_key" in track && track.audio_key ? <CrateChip>{track.audio_key}</CrateChip> : null}
              {"energy" in track && track.energy != null ? <CrateChip>{Math.round(track.energy * 100)}% energy</CrateChip> : null}
              {"danceability" in track && track.danceability != null ? <CrateChip>{Math.round(track.danceability * 100)}% dance</CrateChip> : null}
              {"has_mood" in track ? (
                <CrateChip className={track.has_mood ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/20 bg-amber-500/10 text-amber-100"}>
                  {track.has_mood ? "Mood extracted" : "Mood missing"}
                </CrateChip>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-white/45">Similarity vectors refreshed and ready for related-track features.</div>
          )}
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-white/10 bg-black/15 px-4 py-6 text-sm text-white/35">
          No recent output recorded yet.
        </div>
      )}
    </div>
  );
}

export function Analysis() {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<ActionKey>(null);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api<AnalysisStatus>("/api/manage/analysis-status");
      setStatus(data);
      setError(null);
    } catch {
      setError("Could not load analysis status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh(true), 10000);
    return () => clearInterval(interval);
  }, []);

  async function queueAction(path: string, action: Exclude<ActionKey, null>, success: string) {
    setActiveAction(action);
    try {
      await api(path, "POST");
      toast.success(success);
      setTimeout(() => refresh(true), 800);
    } catch {
      toast.error("The analysis task could not be queued");
    } finally {
      setActiveAction(null);
    }
  }

  const metrics = useMemo(() => {
    if (!status) {
      return {
        analysisPercent: 0,
        blissPercent: 0,
        activeJobs: 0,
        failedJobs: 0,
      };
    }

    return {
      analysisPercent: formatPercent(status.analysis_done, status.total),
      blissPercent: formatPercent(status.bliss_done, status.total),
      activeJobs: status.analysis_active + status.bliss_active,
      failedJobs: status.analysis_failed + status.bliss_failed,
    };
  }, [status]);

  if (loading && !status) {
    return (
      <div className="flex justify-center py-16 text-white/45">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !status) {
    return <ErrorState message={error} onRetry={() => refresh()} />;
  }

  if (!status) {
    return <ErrorState message="No analysis status available" onRetry={() => refresh()} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={AudioWaveform}
        title="Analysis"
        description="Audio features, similarity vectors and background processing coverage across the whole library."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => refresh()} className="gap-2">
              <RefreshCw size={14} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/compute-popularity", "popularity", "Popularity recomputation queued")}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "popularity" ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Recompute popularity
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/compute-bliss", "bliss", "Bliss recomputation queued")}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "bliss" ? <Loader2 size={14} className="animate-spin" /> : <Waves size={14} />}
              Recompute bliss
            </Button>
            <Button
              size="sm"
              onClick={() => queueAction("/api/manage/analyze-all", "analysis", "Full audio re-analysis queued")}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "analysis" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Re-analyze all
            </Button>
          </>
        }
      >
        <CratePill active icon={Music}>{status.total.toLocaleString()} tracks</CratePill>
        <CratePill icon={Gauge}>{metrics.analysisPercent}% audio covered</CratePill>
        <CratePill icon={Waves}>{metrics.blissPercent}% bliss covered</CratePill>
        {metrics.activeJobs > 0 ? <CratePill icon={Activity}>{metrics.activeJobs} active</CratePill> : null}
        {metrics.failedJobs > 0 ? <CratePill className="border-red-500/25 bg-red-500/10 text-red-100">{metrics.failedJobs} failed</CratePill> : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile icon={Music} label="Audio Coverage" value={`${metrics.analysisPercent}%`} caption={`${status.analysis_done.toLocaleString()} analyzed`} tone="primary" />
        <OpsStatTile icon={Waves} label="Bliss Coverage" value={`${metrics.blissPercent}%`} caption={`${status.bliss_done.toLocaleString()} vectors`} />
        <OpsStatTile icon={Activity} label="Active Workers" value={metrics.activeJobs.toLocaleString()} caption="Analysis + bliss jobs currently running" tone={metrics.activeJobs > 0 ? "success" : "default"} />
        <OpsStatTile icon={Zap} label="Failures" value={metrics.failedJobs.toLocaleString()} caption="Tracks that need another pass or repair" tone={metrics.failedJobs > 0 ? "warning" : "default"} />
      </div>

      <OpsPanel
        icon={Gauge}
        title="Pipeline coverage"
        description="Track how far each background pipeline has progressed and spot failures before they rot."
      >
        <div className="grid gap-4 xl:grid-cols-2">
          <PipelineCoverage
            icon={Music}
            title="Audio features"
            done={status.analysis_done}
            pending={status.analysis_pending}
            active={status.analysis_active}
            failed={status.analysis_failed}
            total={status.total}
            accentClassName="text-primary"
            emptyLabel="Waiting for tracks"
          />
          <PipelineCoverage
            icon={Waves}
            title="Bliss vectors"
            done={status.bliss_done}
            pending={status.bliss_pending}
            active={status.bliss_active}
            failed={status.bliss_failed}
            total={status.total}
            accentClassName="text-emerald-300"
            emptyLabel="Waiting for tracks"
          />
        </div>
      </OpsPanel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <OpsPanel
          icon={Activity}
          title="Recent outputs"
          description="The freshest material that made it through each pipeline, useful when you want to sanity-check the daemon."
        >
          <div className="grid gap-4 xl:grid-cols-2">
            <RecentTrackCard icon={Music} title="Last analyzed track" track={status.last_analyzed} />
            <RecentTrackCard icon={Waves} title="Last bliss computation" track={status.last_bliss} />
          </div>
        </OpsPanel>

        <OpsPanel
          icon={Sparkles}
          title="Operator notes"
          description="Quick guidance for what to do next when the coverage numbers are not where you expect them."
        >
          <div className="space-y-3">
            <div className="rounded-sm border border-white/6 bg-black/15 p-3">
              <div className="text-sm font-medium text-white">When to re-run audio analysis</div>
              <div className="mt-1 text-sm text-white/45">
                Use it after metadata fixes, mass imports or when failed counts start to climb after library changes.
              </div>
            </div>
            <div className="rounded-sm border border-white/6 bg-black/15 p-3">
              <div className="text-sm font-medium text-white">When to recompute bliss</div>
              <div className="mt-1 text-sm text-white/45">
                Recompute similarity vectors after large acquisitions or if related-track results start feeling stale.
              </div>
            </div>
            <div className="rounded-sm border border-white/6 bg-black/15 p-3">
              <div className="text-sm font-medium text-white">Popularity jobs</div>
              <div className="mt-1 text-sm text-white/45">
                Popularity is now part of the same operational story. Run it after enrichment waves so sorting and smart playlists stay current.
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}
