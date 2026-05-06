import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import {
  useTopTracks,
  useArtistEnrichment,
  type EnrichmentData,
} from "@/hooks/use-artist-data";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
import { ArtistRepairDialog } from "@/components/artist/ArtistRepairDialog";
import { ArtistDiscographySection } from "@/components/artist/ArtistDiscographySection";
import { ArtistAboutSection } from "@/components/artist/ArtistAboutSection";
import { ArtistLoadingState } from "@/components/artist/ArtistLoadingState";
import { ArtistOverviewSection } from "@/components/artist/ArtistOverviewSection";
import { ArtistSetlistSection } from "@/components/artist/ArtistSetlistSection";
import { ArtistShowsSection, type ArtistShowEvent } from "@/components/artist/ArtistShowsSection";
import { ArtistSimilarSection } from "@/components/artist/ArtistSimilarSection";
import { ArtistStatsSection } from "@/components/artist/ArtistStatsSection";
import { ArtistTopTracksSection } from "@/components/artist/ArtistTopTracksSection";
import { ArtistTabsNav } from "@/components/artist/ArtistTabsNav";
import {
  buildArtistTabs,
  buildArtistTags,
  buildExternalLinks,
  buildMergedSimilarArtists,
  computePopularityScore,
} from "@/components/artist/artistPageData";
import type { ArtistData, TabKey } from "@/components/artist/artistPageTypes";
import { api } from "@/lib/api";
import { artistActionApiPath, artistApiPath, artistManagementApiPath, artistPagePath, tidalDownloadMissingArtistApiPath, tidalMissingArtistApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ArtistRepairPlanSummary {
  total: number;
}

type ArtistMetadataAction = "lyrics" | "portable" | "export" | null;

// ── Main Component ──

export function Artist() {
  const { artistId: artistIdParam, artistSlug } = useParams<{ artistId?: string; artistSlug?: string }>();
  const navigate = useNavigate();
  const artistId = artistIdParam ? Number(artistIdParam) : undefined;
  const { data, loading } = useApi<ArtistData>(
    artistApiPath({
      artistId,
      artistSlug,
    }) || null,
  );
  const [sort, setSort] = useState("name");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [photoCacheBust, setPhotoCacheBust] = useState("");
  const [bgCacheBust, setBgCacheBust] = useState("");
  const [bgLoaded, setBgLoaded] = useState(false);
  // Data fetching hooks (replace manual useEffect + useState)
  const topTracks = useTopTracks(data?.id, data?.entity_uid);
  const [enriching, setEnriching] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showMissing, setShowMissing] = useState(true);
  const [upcomingShows, setUpcomingShows] = useState<ArtistShowEvent[]>([]);
  const [showsLoaded, setShowsLoaded] = useState(false);
  const [missingAlbums, setMissingAlbums] = useState<{ title: string; first_release_date: string; type: string }[]>([]);
  const [missingLoaded, setMissingLoaded] = useState(false);
  const [tidalMissing, setTidalMissing] = useState<{ url: string; title: string; year: string; tracks: number; cover: string | null; quality: string }[]>([]);
  const [tidalMissingLoaded, setTidalMissingLoaded] = useState(false);
  const [downloadingDiscog, setDownloadingDiscog] = useState(false);
  const [allTrackTitles, setAllTrackTitles] = useState<{
    title: string;
    album: string;
    path: string;
    album_id?: number;
    album_slug?: string;
  }[]>([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const { enrichment: fetchedEnrichment, loading: enrichmentLoading } = useArtistEnrichment(data?.id, data?.entity_uid);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRepairDialog, setShowRepairDialog] = useState(false);
  const [metadataAction, setMetadataAction] = useState<ArtistMetadataAction>(null);
  const [issueCountOverride, setIssueCountOverride] = useState<number | null>(null);
  const { isAdmin } = useAuth();
  const rawIssueCount = data?.issue_count ?? 0;
  const shouldLoadRepairPlanSummary = isAdmin && rawIssueCount > 0;
  const repairPlanEndpoint = shouldLoadRepairPlanSummary
    ? artistManagementApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "repair-plan") || null
    : null;
  const { data: repairPlanSummary } = useApi<ArtistRepairPlanSummary>(repairPlanEndpoint);

  useEffect(() => {
    if (artistId == null || !data?.slug) return;
    navigate(artistPagePath({ artistSlug: data.slug, artistName: data.name }), { replace: true });
  }, [artistId, data?.slug, data?.name, navigate]);

  // Sync enrichment from hook (can be overridden by manual enrich)
  useEffect(() => {
    if (fetchedEnrichment) setEnrichment(fetchedEnrichment as EnrichmentData);
  }, [fetchedEnrichment]);

  // Fetch upcoming shows
  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "shows");
    if (!endpoint || showsLoaded) return;
    api<{ events: ArtistShowEvent[]; configured: boolean }>(endpoint)
      .then((d) => { setUpcomingShows(d.events || []); setShowsLoaded(true); })
      .catch(() => setShowsLoaded(true));
  }, [data?.entity_uid, data?.id, showsLoaded]);

  // Fetch all track titles for setlist matching (lazy)
  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "track-titles");
    if (!endpoint || activeTab !== "setlist" || allTrackTitles.length > 0) return;
    api<{ title: string; album: string; path: string; album_id?: number; album_slug?: string }[]>(endpoint)
      .then((d) => { if (Array.isArray(d)) setAllTrackTitles(d); })
      .catch(() => {});
  }, [data?.entity_uid, data?.id, activeTab, allTrackTitles.length]);

  // Fetch missing albums (lazy, on discography tab)
  useEffect(() => {
    const endpoint = artistActionApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "missing");
    if (!endpoint || activeTab !== "discography" || missingLoaded) return;
    let cancelled = false;
    api<{ missing: { title: string; first_release_date: string; type: string }[] }>(endpoint)
      .then((d) => { if (!cancelled) { setMissingAlbums(d.missing ?? []); setMissingLoaded(true); } })
      .catch(() => { if (!cancelled) setMissingLoaded(true); });
    return () => { cancelled = true; };
  }, [data?.entity_uid, data?.id, activeTab, missingLoaded]);

  // Fetch Tidal missing albums (lazy, on discography tab)
  useEffect(() => {
    const endpoint = tidalMissingArtistApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid });
    if (!endpoint || activeTab !== "discography" || tidalMissingLoaded) return;
    api<{ albums: typeof tidalMissing; authenticated: boolean }>(endpoint)
      .then((d) => { if (d.albums) setTidalMissing(d.albums); setTidalMissingLoaded(true); })
      .catch(() => setTidalMissingLoaded(true));
  }, [data?.entity_uid, data?.id, activeTab, tidalMissingLoaded]);

  if (loading) return <ArtistLoadingState />;

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const artistName = data.name;
  const totalTracks = data.total_tracks ?? data.albums.reduce((s, a) => s + a.tracks, 0);
  const totalSize = data.total_size_mb ?? data.albums.reduce((s, a) => s + a.size_mb, 0);
  const letter = artistName.charAt(0).toUpperCase();
  const issueCount = issueCountOverride ?? repairPlanSummary?.total ?? rawIssueCount;
  const showRepairAction = issueCount > 0;

  const sortedAlbums = [...data.albums].sort((a, b) => {
    if (sort === "year") return (b.year || "").localeCompare(a.year || "");
    if (sort === "tracks") return b.tracks - a.tracks;
    return a.name.localeCompare(b.name);
  });

  const bioText = enrichment?.lastfm?.bio ?? "";
  const mb = enrichment?.musicbrainz;
  const spotify = enrichment?.spotify;
  const lastfm = enrichment?.lastfm;
  const setlistData = enrichment?.setlist;
  const allTags = buildArtistTags(data.genres, enrichment);

  const mergedSimilar = buildMergedSimilarArtists(enrichment);
  const externalLinks = buildExternalLinks(enrichment);
  const tabs = buildArtistTabs(upcomingShows.length);
  const activeMembers = mb?.members?.filter((m) => !m.end) ?? [];
  const popularityScore =
    data.popularity_score != null
      ? Math.round(data.popularity_score * 100)
      : computePopularityScore(spotify?.popularity, lastfm?.listeners);

  async function enrichArtist() {
    setEnriching(true);
    try {
      const endpoint = artistActionApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "enrich");
      if (!endpoint) throw new Error("artist reference missing");
      const res = await api<{ status: string; task_id: string }>(endpoint, "POST");
      toast.success("Enrichment started", { description: "This may take a moment..." });
      const task = await waitForTask(res.task_id, 120000);
      setEnriching(false);
      if (task.status === "completed") {
        toast.success("Artist enriched!");
        window.location.reload();
      } else if (task.status === "failed") {
        toast.error("Enrichment failed");
      }
    } catch {
      setEnriching(false);
      toast.error("Failed to start enrichment");
    }
  }

  async function analyzeArtist() {
    try {
      const endpoint = artistManagementApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "reanalyze");
      if (!endpoint) throw new Error("artist reference missing");
      await api(endpoint, "POST");
      toast.success("Analysis queued", { description: "Background daemons will process the tracks." });
    } catch {
      toast.error("Failed to queue analysis");
    }
  }

  async function repairArtist() {
    setShowRepairDialog(true);
  }

  async function downloadMissingDiscography() {
    setDownloadingDiscog(true);
    try {
      const endpoint = tidalDownloadMissingArtistApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid });
      if (!endpoint) throw new Error("artist reference missing");
      const res = await api<{ queued: number }>(endpoint, "POST", {
        albums: tidalMissing.map((album) => ({ url: album.url, title: album.title, cover_url: album.cover })),
      });
      toast.success(`Queued ${res.queued} albums for download`);
      setTidalMissing([]);
    } catch {
      toast.error("Failed to queue downloads");
    } finally {
      setDownloadingDiscog(false);
    }
  }

  async function queueArtistMetadataAction(action: Exclude<ArtistMetadataAction, null>) {
    setMetadataAction(action);
    try {
      if (action === "lyrics") {
        await api("/api/manage/sync-lyrics", "POST", { artist: artistName, limit: 1000 });
        toast.success("Lyrics sync queued");
      } else if (action === "portable") {
        await api("/api/manage/portable-metadata", "POST", {
          artist: artistName,
          write_audio_tags: true,
          write_sidecars: true,
        });
        toast.success("Portable metadata queued");
      } else {
        await api("/api/manage/portable-metadata/export-rich", "POST", {
          artist: artistName,
          include_audio: false,
          write_rich_tags: false,
        });
        toast.success("Rich metadata export queued");
      }
    } catch {
      toast.error("Failed to queue metadata task");
    } finally {
      setMetadataAction(null);
    }
  }

  return (
    <div className="-mt-16 md:-mt-[6.5rem]">
        <ArtistHeroSection
          artistName={artistName}
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          artistSlug={data.slug}
          imageVersion={data.updated_at}
          letter={letter}
        albumCount={data.albums.length}
        totalTracks={totalTracks}
        totalSizeMb={totalSize}
        issueCount={issueCount}
        showRepairAction={showRepairAction}
        musicbrainz={mb}
        lastfmListeners={lastfm?.listeners}
        upcomingShow={upcomingShows[0]}
        popularityScore={popularityScore}
        genreProfile={data.genre_profile}
        tags={allTags}
        enriching={enriching}
        isAdmin={isAdmin}
        photoLoaded={photoLoaded}
        photoError={photoError}
        photoCacheBust={photoCacheBust}
        bgCacheBust={bgCacheBust}
        bgLoaded={bgLoaded}
        onBackgroundLoad={() => setBgLoaded(true)}
        onPhotoLoad={() => setPhotoLoaded(true)}
        onPhotoError={() => setPhotoError(true)}
        onBackgroundUploaded={() => {
          setBgLoaded(false);
          setBgCacheBust(String(Date.now()));
        }}
        onPhotoUploaded={() => {
          setPhotoError(false);
          setPhotoLoaded(false);
          setPhotoCacheBust(String(Date.now()));
        }}
        onEnrich={() => {
          void enrichArtist();
        }}
        onAnalyze={() => {
          void analyzeArtist();
        }}
        onRepair={() => {
          void repairArtist();
        }}
        metadataAction={metadataAction}
        onSyncLyrics={() => {
          void queueArtistMetadataAction("lyrics");
        }}
        onWritePortableMetadata={() => {
          void queueArtistMetadataAction("portable");
        }}
        onExportRichMetadata={() => {
          void queueArtistMetadataAction("export");
        }}
        onDelete={() => setShowDeleteConfirm(true)}
      />

      <ArtistTabsNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* ═══ CONTENT ═══ */}
      <div className="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-6 md:px-8">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <ArtistOverviewSection
            bioText={bioText}
            bioExpanded={bioExpanded}
            onToggleBioExpanded={() => setBioExpanded(!bioExpanded)}
            topTracks={topTracks}
            musicbrainz={mb}
            activeMembersCount={activeMembers.length}
            lastfm={lastfm}
            spotify={spotify}
            externalLinks={externalLinks}
            enrichmentLoading={enrichmentLoading}
          />
        )}

        {/* ── Top Tracks Tab ── */}
        {activeTab === "top-tracks" && (
          <div className="max-w-4xl">
            <ArtistTopTracksSection
              topTracks={topTracks}
              spotifyTopTracks={spotify?.top_tracks}
            />
          </div>
        )}

        {/* ── Discography Tab ── */}
        {activeTab === "discography" && (
          <ArtistDiscographySection
            artistName={artistName}
            artistId={data.id}
            artistEntityUid={data.entity_uid}
            artistSlug={data.slug}
            albums={data.albums}
            sortedAlbums={sortedAlbums}
            missingAlbums={missingAlbums}
            tidalMissing={tidalMissing}
            showMissing={showMissing}
            sort={sort}
            downloadingDiscog={downloadingDiscog}
            onToggleShowMissing={() => setShowMissing(!showMissing)}
            onSortChange={setSort}
            onDownloadDiscography={() => {
              void downloadMissingDiscography();
            }}
          />
        )}

        {/* ── Probable Setlist Tab ── */}
        {activeTab === "setlist" && (
          <ArtistSetlistSection
            artistName={artistName}
            artistId={data.id}
            artistEntityUid={data.entity_uid}
            setlistData={setlistData}
            allTrackTitles={allTrackTitles}
            onTrackTitlesLoaded={setAllTrackTitles}
          />
        )}

        {/* ── Shows Tab ── */}
        {activeTab === "shows" && (
          <ArtistShowsSection
            artistName={artistName}
            artistId={data.id}
            artistSlug={data.slug}
            shows={upcomingShows}
          />
        )}

        {/* ── Similar Artists Tab ── */}
        {activeTab === "similar" && (
          <ArtistSimilarSection artistName={artistName} artistId={data.id} artistEntityUid={data.entity_uid} artists={mergedSimilar} />
        )}

        {/* ── Stats Tab ── */}
        {activeTab === "stats" && (
          <ArtistStatsSection artistName={artistName} artistId={data.id} artistEntityUid={data.entity_uid} />
        )}

        {/* ── About Tab ── */}
        {activeTab === "about" && (
          <ArtistAboutSection
            bioText={bioText}
            bioExpanded={bioExpanded}
            onToggleBioExpanded={() => setBioExpanded(!bioExpanded)}
            musicbrainz={mb}
            lastfm={lastfm}
            spotify={spotify}
            externalLinks={externalLinks}
            albumCount={data.albums.length}
            totalTracks={totalTracks}
            totalSizeMb={totalSize}
          />
        )}
      </div>

      {/* Delete Artist Confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={`Delete ${data?.name ?? "artist"}?`}
        description={`This will permanently delete ${data?.name ?? "this artist"} and all their albums/tracks from the database AND the filesystem. This action cannot be undone.`}
        confirmLabel="Delete Artist"
        variant="destructive"
        onConfirm={async () => {
          try {
            const endpoint = artistManagementApiPath({ artistId: data?.id, artistEntityUid: data?.entity_uid }, "delete");
            if (!endpoint) throw new Error("artist reference missing");
            await api<{ task_id: string }>(endpoint, "POST", { mode: "full" });
            toast.success(`Deletion queued for ${data!.name}`, {
              description: "The worker will delete the artist in the background.",
            });
            window.location.href = "/browse";
          } catch (error) {
            const message =
              error instanceof Error && error.message
                ? error.message
                : "Failed to queue artist deletion";
            toast.error(message);
          }
        }}
      />
      <ArtistRepairDialog
        open={showRepairDialog}
        onOpenChange={setShowRepairDialog}
        artistName={artistName}
        artistId={data.id}
        artistEntityUid={data.entity_uid}
        onIssueCountChange={setIssueCountOverride}
      />
    </div>
  );
}
