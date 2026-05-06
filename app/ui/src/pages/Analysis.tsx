import { useMemo, useState } from "react";
import {
  Activity,
  Archive,
  AudioWaveform,
  FileInput,
  FileJson,
  Fingerprint,
  Gauge,
  Loader2,
  Music,
  RefreshCw,
  Sparkles,
  Tags,
  Waves,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { Button } from "@crate/ui/shadcn/button";
import { useOpsSnapshot, type AnalysisStatusSnapshot } from "@/contexts/OpsSnapshotContext";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type ActionKey = "analysis" | "bliss" | "popularity" | "fingerprints" | "lyrics" | "portable" | "rehydrate" | "richExport" | null;

const EMPTY_TRACK = {};

function numberOrZero(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeStatus(status: AnalysisStatusSnapshot): AnalysisStatusSnapshot {
  return {
    total: numberOrZero(status.total),
    analysis_done: numberOrZero(status.analysis_done),
    analysis_pending: numberOrZero(status.analysis_pending),
    analysis_active: numberOrZero(status.analysis_active),
    analysis_failed: numberOrZero(status.analysis_failed),
    bliss_done: numberOrZero(status.bliss_done),
    bliss_pending: numberOrZero(status.bliss_pending),
    bliss_active: numberOrZero(status.bliss_active),
    bliss_failed: numberOrZero(status.bliss_failed),
    fingerprint_done: numberOrZero(status.fingerprint_done),
    fingerprint_pending: numberOrZero(status.fingerprint_pending),
    fingerprint_chromaprint: numberOrZero(status.fingerprint_chromaprint),
    fingerprint_pcm: numberOrZero(status.fingerprint_pcm),
    chromaprint_available: Boolean(status.chromaprint_available),
    fingerprint_strategy: status.fingerprint_strategy || "unavailable",
    total_albums: numberOrZero(status.total_albums),
    lyrics_cached: numberOrZero(status.lyrics_cached),
    lyrics_found: numberOrZero(status.lyrics_found),
    lyrics_missing: numberOrZero(status.lyrics_missing),
    portable_sidecar_albums: numberOrZero(status.portable_sidecar_albums),
    portable_audio_tag_albums: numberOrZero(status.portable_audio_tag_albums),
    portable_audio_tag_tracks: numberOrZero(status.portable_audio_tag_tracks),
    portable_tag_errors: numberOrZero(status.portable_tag_errors),
    rich_export_albums: numberOrZero(status.rich_export_albums),
    rich_export_tracks: numberOrZero(status.rich_export_tracks),
    last_analyzed: status.last_analyzed || EMPTY_TRACK,
    last_bliss: status.last_bliss || EMPTY_TRACK,
  };
}

function formatPercent(done: number, total: number) {
  if (total <= 0) return 0;
  if (done >= total) return 100;
  const raw = (done / total) * 100;
  if (raw > 0 && raw < 0.1) return 0.1;
  return Number(Math.min(raw, 99.9).toFixed(1));
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
  track: AnalysisStatusSnapshot["last_analyzed"] | AnalysisStatusSnapshot["last_bliss"];
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
  const { data: opsSnapshot, loading, error, refresh } = useOpsSnapshot();
  const rawStatus = opsSnapshot?.analysis ?? null;
  const status = useMemo(() => (rawStatus ? normalizeStatus(rawStatus) : null), [rawStatus]);
  const [activeAction, setActiveAction] = useState<ActionKey>(null);

  async function queueAction(path: string, action: Exclude<ActionKey, null>, success: string, body?: Record<string, unknown>) {
    setActiveAction(action);
    try {
      await api(path, "POST", body);
      toast.success(success);
      setTimeout(() => void refresh(true), 800);
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
        fingerprintPercent: 0,
        lyricsPercent: 0,
        portableSidecarPercent: 0,
        portableTagPercent: 0,
        activeJobs: 0,
        failedJobs: 0,
      };
    }

    return {
      analysisPercent: formatPercent(status.analysis_done, status.total),
      blissPercent: formatPercent(status.bliss_done, status.total),
      fingerprintPercent: formatPercent(status.fingerprint_done, status.total),
      lyricsPercent: formatPercent(status.lyrics_cached, status.total),
      portableSidecarPercent: formatPercent(status.portable_sidecar_albums, status.total_albums),
      portableTagPercent: formatPercent(status.portable_audio_tag_tracks, status.total),
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
    return <ErrorState message={error} onRetry={() => void refresh(true)} />;
  }

  if (!status) {
    return <ErrorState message="No analysis status available" onRetry={() => void refresh(true)} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={AudioWaveform}
        title="Analysis"
        description="Audio features, similarity vectors and background processing coverage across the whole library."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void refresh(true)} className="gap-2">
              <RefreshCw size={14} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/tasks/backfill-track-fingerprints", "fingerprints", "Audio fingerprint backfill queued")}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "fingerprints" ? <Loader2 size={14} className="animate-spin" /> : <Fingerprint size={14} />}
              Backfill fingerprints
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
        <CratePill icon={Fingerprint}>{metrics.fingerprintPercent}% fingerprinted</CratePill>
        <CratePill icon={FileJson}>{metrics.lyricsPercent}% lyrics cached</CratePill>
        <CratePill icon={Tags}>{metrics.portableSidecarPercent}% portable albums</CratePill>
        <CratePill className={status.chromaprint_available ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" : "border-amber-500/25 bg-amber-500/10 text-amber-100"}>
          {status.chromaprint_available ? "Chromaprint ready" : "PCM fallback"}
        </CratePill>
        {metrics.activeJobs > 0 ? <CratePill icon={Activity}>{metrics.activeJobs} active</CratePill> : null}
        {metrics.failedJobs > 0 ? <CratePill className="border-red-500/25 bg-red-500/10 text-red-100">{metrics.failedJobs} failed</CratePill> : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <OpsStatTile icon={Music} label="Audio Coverage" value={`${metrics.analysisPercent}%`} caption={`${status.analysis_done.toLocaleString()} analyzed`} tone="primary" />
        <OpsStatTile icon={Waves} label="Bliss Coverage" value={`${metrics.blissPercent}%`} caption={`${status.bliss_done.toLocaleString()} vectors`} />
        <OpsStatTile
          icon={Fingerprint}
          label="Fingerprint Coverage"
          value={`${metrics.fingerprintPercent}%`}
          caption={`${status.fingerprint_done.toLocaleString()} tracks fingerprinted`}
          tone={status.chromaprint_available ? "success" : "warning"}
        />
        <OpsStatTile icon={FileJson} label="Lyrics Cache" value={`${metrics.lyricsPercent}%`} caption={`${status.lyrics_found.toLocaleString()} tracks with lyrics`} tone="success" />
        <OpsStatTile icon={Tags} label="Portable Metadata" value={`${metrics.portableSidecarPercent}%`} caption={`${status.portable_audio_tag_tracks.toLocaleString()} tracks tagged`} tone={status.portable_tag_errors > 0 ? "warning" : "default"} />
      </div>

      <OpsPanel
        icon={Gauge}
        title="Pipeline coverage"
        description="Track how far each background pipeline has progressed and spot failures before they rot."
      >
        <div className="grid gap-4 xl:grid-cols-3">
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
          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-sky-300">
                  <Fingerprint size={16} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-white">Audio fingerprints</div>
                  <div className="text-xs text-white/40">
                    {status.total > 0
                      ? `${status.fingerprint_done.toLocaleString()} of ${status.total.toLocaleString()} tracks fingerprinted`
                      : "Waiting for tracks"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CrateChip className="text-[10px]">{metrics.fingerprintPercent}% coverage</CrateChip>
                <CrateChip className={status.chromaprint_available ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-amber-500/20 bg-amber-500/10 text-amber-100"}>
                  {status.chromaprint_available ? "Chromaprint active" : "PCM fallback"}
                </CrateChip>
              </div>
            </div>

            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-sm bg-white/[0.06]">
                <div
                  className="h-full rounded-sm bg-sky-400/80 transition-all duration-500"
                  style={{ width: `${Math.min(metrics.fingerprintPercent, 100)}%` }}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <MiniMetric label="Done" value={status.fingerprint_done.toLocaleString()} />
                <MiniMetric label="Pending" value={status.fingerprint_pending.toLocaleString()} />
                <MiniMetric label="Chromaprint" value={status.fingerprint_chromaprint.toLocaleString()} />
                <MiniMetric label="PCM Fallback" value={status.fingerprint_pcm.toLocaleString()} tone={status.fingerprint_pcm > 0 ? "muted" : "default"} />
              </div>
            </div>
          </div>
        </div>
      </OpsPanel>

      <OpsPanel
        icon={FileJson}
        title="Portable library state"
        description="Lyrics cache, portable sidecars, identity tags and export coverage."
        action={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/sync-lyrics", "lyrics", "Lyrics sync queued", { limit: 1000 })}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "lyrics" ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
              Sync lyrics
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/portable-metadata", "portable", "Portable metadata write queued", { write_audio_tags: true, write_sidecars: true })}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "portable" ? <Loader2 size={14} className="animate-spin" /> : <Tags size={14} />}
              Write metadata
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/portable-metadata/rehydrate", "rehydrate", "Portable metadata rehydrate queued")}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "rehydrate" ? <Loader2 size={14} className="animate-spin" /> : <FileInput size={14} />}
              Rehydrate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => queueAction("/api/manage/portable-metadata/export-rich", "richExport", "Rich metadata export queued", { include_audio: false, write_rich_tags: false })}
              disabled={activeAction !== null}
              className="gap-2"
            >
              {activeAction === "richExport" ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Export index
            </Button>
          </>
        }
      >
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-violet-200">
                  <FileJson size={16} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-white">Lyrics</div>
                  <div className="text-xs text-white/40">
                    {status.lyrics_cached.toLocaleString()} cached lookups across {status.total.toLocaleString()} tracks
                  </div>
                </div>
              </div>
              <CrateChip className="text-[10px]">{metrics.lyricsPercent}% cache</CrateChip>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Cached" value={status.lyrics_cached.toLocaleString()} />
              <MiniMetric label="Found" value={status.lyrics_found.toLocaleString()} />
              <MiniMetric label="Missing" value={status.lyrics_missing.toLocaleString()} tone={status.lyrics_missing > 0 ? "muted" : "default"} />
            </div>
          </div>

          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-emerald-200">
                  <Tags size={16} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-white">Portable metadata</div>
                  <div className="text-xs text-white/40">
                    {status.portable_sidecar_albums.toLocaleString()} sidecars across {status.total_albums.toLocaleString()} albums
                  </div>
                </div>
              </div>
              <CrateChip className="text-[10px]">{metrics.portableSidecarPercent}% albums</CrateChip>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <MiniMetric label="Sidecars" value={status.portable_sidecar_albums.toLocaleString()} />
              <MiniMetric label="Tag albums" value={status.portable_audio_tag_albums.toLocaleString()} />
              <MiniMetric label="Tag tracks" value={status.portable_audio_tag_tracks.toLocaleString()} />
              <MiniMetric label="Errors" value={status.portable_tag_errors.toLocaleString()} tone={status.portable_tag_errors > 0 ? "danger" : "default"} />
            </div>
          </div>

          <div className="rounded-md border border-white/8 bg-black/20 p-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] text-sky-200">
                  <Archive size={16} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium text-white">Rich exports</div>
                  <div className="text-xs text-white/40">
                    {status.rich_export_albums.toLocaleString()} albums exported as portable packages
                  </div>
                </div>
              </div>
              <CrateChip className="text-[10px]">{status.rich_export_tracks.toLocaleString()} tracks</CrateChip>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <MiniMetric label="Albums" value={status.rich_export_albums.toLocaleString()} />
              <MiniMetric label="Tracks" value={status.rich_export_tracks.toLocaleString()} />
              <MiniMetric label="Tag coverage" value={`${metrics.portableTagPercent}%`} />
            </div>
          </div>
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
            <div className="rounded-sm border border-white/6 bg-black/15 p-3">
              <div className="text-sm font-medium text-white">AcoustID / Chromaprint</div>
              <div className="mt-1 text-sm text-white/45">
                Track fingerprints now prefer Chromaprint via <code>fpcalc</code>. If the runtime cannot see it, Crate falls back to deterministic PCM hashing so identity backfills can still progress.
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>
    </div>
  );
}
