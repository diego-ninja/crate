import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  CalendarDays,
  CheckCircle2,
  Disc3,
  Download,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { OpsPageHero, OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { ActionIconButton } from "@crate-ui/primitives/ActionIconButton";
import { Button } from "@crate-ui/shadcn/button";
import { CrateChip, CratePill } from "@crate-ui/primitives/CrateBadge";
import { ErrorState } from "@crate-ui/primitives/ErrorState";
import { Input } from "@crate-ui/shadcn/input";
import { api } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { timeAgo } from "@/lib/utils";

interface Release {
  id: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_title: string;
  album_id?: number;
  album_slug?: string;
  tidal_id: string;
  tidal_url: string;
  cover_url: string;
  year: string;
  release_date: string | null;
  release_type: string | null;
  tracks: number;
  quality: string;
  status: string;
  detected_at: string;
  downloaded_at: string | null;
}

type ViewMode = "timeline" | "grid";
type StatusFilter = "all" | "detected" | "downloading" | "downloaded" | "upcoming";

function releaseArtistHref(release: Release) {
  if (release.artist_id == null) return undefined;
  return artistPagePath({
    artistId: release.artist_id,
    artistSlug: release.artist_slug,
    artistName: release.artist_name,
  });
}

function releaseAlbumHref(release: Release) {
  if (release.album_id == null) return undefined;
  return albumPagePath({
    albumId: release.album_id,
    albumSlug: release.album_slug,
    artistName: release.artist_name,
    albumName: release.album_title,
  });
}

function releaseDateValue(release: Release) {
  return release.release_date || release.detected_at?.slice(0, 10) || "";
}

function isUpcomingRelease(release: Release) {
  const date = release.release_date;
  if (!date) return false;
  return date >= new Date().toISOString().slice(0, 10);
}

function ReleaseDateBadge({ release }: { release: Release }) {
  const raw = releaseDateValue(release);
  if (!raw) {
    return <span className="text-xs text-white/25">Unknown date</span>;
  }

  const date = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return <span className="text-xs text-white/25">{raw}</span>;
  }

  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-[0.12em] text-white/30">
        {date.toLocaleDateString("en-US", { month: "short" })}
      </div>
      <div className="text-lg font-semibold leading-none text-white/75">{date.getDate()}</div>
    </div>
  );
}

function ReleaseMeta({ release }: { release: Release }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
      {release.release_type ? <CrateChip>{release.release_type}</CrateChip> : null}
      {release.quality ? <CrateChip className="border-emerald-500/25 bg-emerald-500/10 text-emerald-200">{release.quality}</CrateChip> : null}
      {release.year ? <CrateChip>{release.year}</CrateChip> : null}
      {release.tracks > 0 ? <CrateChip>{release.tracks} tracks</CrateChip> : null}
      <CrateChip>{timeAgo(release.detected_at)}</CrateChip>
    </div>
  );
}

function ReleaseActions({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  if (release.status === "downloaded") {
    return <CrateChip className="border-emerald-500/25 bg-emerald-500/10 text-emerald-200">Downloaded</CrateChip>;
  }
  if (release.status === "downloading") {
    return (
      <CrateChip active icon={Loader2}>
        Downloading
      </CrateChip>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {release.tidal_url ? (
        <Button size="sm" className="gap-2" onClick={() => onDownload(release.id)}>
          <Download size={14} />
          Download
        </Button>
      ) : null}
      <ActionIconButton variant="card" tone="danger" onClick={() => onDismiss(release.id)} title="Dismiss release">
        <X size={15} />
      </ActionIconButton>
    </div>
  );
}

function ReleaseTimelineRow({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const artistHref = releaseArtistHref(release);
  const albumHref = releaseAlbumHref(release);

  return (
    <div className="group flex flex-col gap-3 rounded-md border border-white/8 bg-black/15 p-4 transition-colors hover:border-white/14 hover:bg-white/[0.04] xl:flex-row xl:items-center">
      <div className="flex items-center gap-4 xl:w-[320px] xl:flex-shrink-0">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.03]">
          <ReleaseDateBadge release={release} />
        </div>
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.04]">
          {release.cover_url ? (
            <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Disc3 size={18} className="text-white/20" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {albumHref ? (
            <Link to={albumHref} className="block truncate text-base font-semibold tracking-tight text-white transition-colors hover:text-primary">
              {release.album_title}
            </Link>
          ) : (
            <div className="truncate text-base font-semibold tracking-tight text-white">{release.album_title}</div>
          )}
          {artistHref ? (
            <Link to={artistHref} className="text-sm text-white/45 transition-colors hover:text-white/80">
              {release.artist_name}
            </Link>
          ) : (
            <div className="text-sm text-white/45">{release.artist_name}</div>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <ReleaseMeta release={release} />
        <div className="text-sm text-white/35">
          {isUpcomingRelease(release) ? "Upcoming release on the radar" : "Detected by the release monitor and ready for acquisition triage"}
        </div>
      </div>

      <div className="flex items-center xl:justify-end">
        <ReleaseActions release={release} onDownload={onDownload} onDismiss={onDismiss} />
      </div>
    </div>
  );
}

function ReleaseGridCard({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const albumHref = releaseAlbumHref(release);
  const artistHref = releaseArtistHref(release);

  return (
    <div className="group overflow-hidden rounded-md border border-white/8 bg-black/20 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="relative aspect-square bg-white/[0.04]">
        {release.cover_url ? (
          <img src={release.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={32} className="text-white/20" />
          </div>
        )}

        <div className="absolute left-3 top-3">
          {release.status === "detected" ? <CrateChip active>Detected</CrateChip> : null}
          {release.status === "downloading" ? <CrateChip active>Downloading</CrateChip> : null}
          {release.status === "downloaded" ? <CrateChip className="border-emerald-500/25 bg-emerald-500/10 text-emerald-200">Downloaded</CrateChip> : null}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1">
          {albumHref ? (
            <Link to={albumHref} className="block truncate text-sm font-semibold text-white transition-colors hover:text-primary">
              {release.album_title}
            </Link>
          ) : (
            <div className="truncate text-sm font-semibold text-white">{release.album_title}</div>
          )}
          {artistHref ? (
            <Link to={artistHref} className="block truncate text-xs text-white/45 transition-colors hover:text-white/80">
              {release.artist_name}
            </Link>
          ) : (
            <div className="truncate text-xs text-white/45">{release.artist_name}</div>
          )}
        </div>

        <ReleaseMeta release={release} />

        <div className="flex items-center gap-2">
          {release.status === "detected" && release.tidal_url ? (
            <Button size="sm" className="flex-1 gap-2" onClick={() => onDownload(release.id)}>
              <Download size={14} />
              Download
            </Button>
          ) : null}
          {release.status === "detected" ? (
            <ActionIconButton variant="card" tone="danger" onClick={() => onDismiss(release.id)} title="Dismiss release">
              <X size={15} />
            </ActionIconButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-white/10 bg-black/15 px-4 py-16 text-center">
      <Disc3 size={34} className="mx-auto mb-3 text-white/20" />
      <div className="text-lg font-semibold text-white/80">{title}</div>
      <div className="mx-auto mt-2 max-w-xl text-sm text-white/40">{description}</div>
    </div>
  );
}

export function NewReleases() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("detected");
  const [typeFilter, setTypeFilter] = useState("");
  const [view, setView] = useState<ViewMode>("timeline");

  async function fetchReleases(silent = false) {
    if (!silent) setLoading(true);
    try {
      const data = await api<{ releases: Release[] }>("/api/acquisition/new-releases?status=");
      setReleases(data.releases || []);
      setError(null);
    } catch {
      setError("Failed to load release radar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReleases();
  }, []);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const release of releases) {
      const value = (release.release_type || "unknown").trim();
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([value, count]) => ({
      value,
      label: value === "unknown" ? "Unknown type" : value,
      count,
    }));
  }, [releases]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return releases.filter((release) => {
      if (statusFilter === "detected" && release.status !== "detected") return false;
      if (statusFilter === "downloading" && release.status !== "downloading") return false;
      if (statusFilter === "downloaded" && release.status !== "downloaded") return false;
      if (statusFilter === "upcoming" && !isUpcomingRelease(release)) return false;
      if (typeFilter && (release.release_type || "unknown") !== typeFilter) return false;
      if (!normalized) return true;
      return `${release.artist_name} ${release.album_title} ${release.release_type || ""}`.toLowerCase().includes(normalized);
    }).sort((a, b) => releaseDateValue(b).localeCompare(releaseDateValue(a)));
  }, [releases, search, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    const detected = releases.filter((release) => release.status === "detected").length;
    const downloading = releases.filter((release) => release.status === "downloading").length;
    const downloaded = releases.filter((release) => release.status === "downloaded").length;
    const upcoming = releases.filter((release) => isUpcomingRelease(release)).length;
    return { detected, downloading, downloaded, upcoming };
  }, [releases]);

  async function checkNow() {
    setChecking(true);
    try {
      const { task_id } = await api<{ task_id: string }>("/api/acquisition/new-releases/check", "POST");
      toast.success("Checking for new releases…");

      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${task_id}`);
          if (task.status === "completed" || task.status === "failed") {
            clearInterval(poll);
            setChecking(false);
            if (task.status === "completed") {
              toast.success("Release check complete");
              fetchReleases(true);
            }
          }
        } catch {
          // ignore transient polling failures
        }
      }, 4000);

      setTimeout(() => {
        clearInterval(poll);
        setChecking(false);
      }, 300000);
    } catch {
      setChecking(false);
      toast.error("Failed to queue the release check");
    }
  }

  async function downloadRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/download`, "POST");
      toast.success("Download started");
      setReleases((current) => current.map((release) => release.id === id ? { ...release, status: "downloading" } : release));
    } catch {
      toast.error("Download failed");
    }
  }

  async function dismissRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/dismiss`, "POST");
      setReleases((current) => current.filter((release) => release.id !== id));
    } catch {
      toast.error("Dismiss failed");
    }
  }

  if (error && releases.length === 0) {
    return <ErrorState message={error} onRetry={() => fetchReleases()} />;
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Sparkles}
        title="New Releases"
        description="Release radar for library artists, with quick triage for what should land next in Crate."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-md border border-white/10 bg-black/20 p-1">
              <Button variant={view === "timeline" ? "default" : "ghost"} size="sm" className="h-9 px-3" onClick={() => setView("timeline")}>
                <List size={14} className="mr-1.5" />
                Timeline
              </Button>
              <Button variant={view === "grid" ? "default" : "ghost"} size="sm" className="h-9 px-3" onClick={() => setView("grid")}>
                <LayoutGrid size={14} className="mr-1.5" />
                Grid
              </Button>
            </div>
            <Button size="sm" onClick={checkNow} disabled={checking} className="gap-2">
              {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {checking ? "Checking…" : "Check now"}
            </Button>
          </>
        }
      >
        <CratePill active icon={Sparkles}>{releases.length} total</CratePill>
        <CratePill icon={Download}>{stats.detected} need action</CratePill>
        <CratePill icon={Loader2}>{stats.downloading} downloading</CratePill>
        <CratePill icon={CheckCircle2}>{stats.downloaded} in library</CratePill>
        <CratePill icon={CalendarDays}>{stats.upcoming} upcoming</CratePill>
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile icon={Download} label="Needs action" value={stats.detected.toLocaleString()} caption="Detected releases waiting for a decision" tone={stats.detected > 0 ? "primary" : "default"} />
        <OpsStatTile icon={Loader2} label="Downloading" value={stats.downloading.toLocaleString()} caption="Acquisition tasks in flight" tone={stats.downloading > 0 ? "warning" : "default"} />
        <OpsStatTile icon={CheckCircle2} label="Downloaded" value={stats.downloaded.toLocaleString()} caption="Already landed in the library" tone={stats.downloaded > 0 ? "success" : "default"} />
        <OpsStatTile icon={CalendarDays} label="Upcoming" value={stats.upcoming.toLocaleString()} caption="Future-dated releases still on the radar" />
      </div>

      <OpsPanel
        icon={Search}
        title="Radar filters"
        description="Search by artist or album, then narrow the radar by acquisition state or release type."
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative min-w-[260px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search artist or album..."
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CratePill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</CratePill>
            <CratePill active={statusFilter === "detected"} onClick={() => setStatusFilter("detected")}>Needs action</CratePill>
            <CratePill active={statusFilter === "downloading"} onClick={() => setStatusFilter("downloading")}>Downloading</CratePill>
            <CratePill active={statusFilter === "downloaded"} onClick={() => setStatusFilter("downloaded")}>Downloaded</CratePill>
            <CratePill active={statusFilter === "upcoming"} onClick={() => setStatusFilter("upcoming")}>Upcoming</CratePill>
          </div>
          <AdminSelect
            value={typeFilter}
            onChange={setTypeFilter}
            options={typeOptions}
            placeholder="All types"
            searchable
            searchPlaceholder="Filter release types..."
            triggerClassName="min-w-[170px]"
          />
        </div>
      </OpsPanel>

      <OpsPanel
        icon={Sparkles}
        title="Release radar"
        description="Use timeline when you want to triage in date order, or grid when you need a visual scan of artwork and release types."
      >
        {loading ? (
          <div className="flex justify-center py-16 text-white/45">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No releases match the current radar"
            description="Try widening the filters or run a fresh release check to bring new detections into the queue."
          />
        ) : view === "timeline" ? (
          <div className="space-y-3">
            {filtered.map((release) => (
              <ReleaseTimelineRow
                key={release.id}
                release={release}
                onDownload={downloadRelease}
                onDismiss={dismissRelease}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {filtered.map((release) => (
              <ReleaseGridCard
                key={release.id}
                release={release}
                onDownload={downloadRelease}
                onDismiss={dismissRelease}
              />
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
