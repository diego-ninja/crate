import { useState, useEffect } from "react";
import { useParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import {
  useNavidromeLink,
  useTopTracks,
  useArtistEnrichment,
  type EnrichmentData,
  type TopTrack,
} from "@/hooks/use-artist-data";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
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
import { usePlayerActions, type Track as PlayerTrack } from "@/contexts/PlayerContext";
import { encPath } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ── Main Component ──

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : "";
  const { data, loading } = useApi<ArtistData>(
    name ? `/api/artist/${encPath(decodedName)}` : null,
  );
  const player = usePlayerActions();
  // Use audioElement.paused directly to avoid re-rendering the whole page (and the graph) on play/pause
  const isTrackPlaying = () => player.audioElement ? !player.audioElement.paused : false;
  const [sort, setSort] = useState("name");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [photoCacheBust, setPhotoCacheBust] = useState("");
  const [bgCacheBust, setBgCacheBust] = useState("");
  const [bgLoaded, setBgLoaded] = useState(false);
  // Data fetching hooks (replace manual useEffect + useState)
  const navidromeLink = useNavidromeLink(data?.name);
  const topTracks = useTopTracks(data?.name);
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
  const [allTrackTitles, setAllTrackTitles] = useState<{ title: string; album: string; path: string }[]>([]);
  const [bioExpanded, setBioExpanded] = useState(false);
  const { enrichment: fetchedEnrichment, loading: enrichmentLoading } = useArtistEnrichment(data?.name);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin } = useAuth();

  // Sync enrichment from hook (can be overridden by manual enrich)
  useEffect(() => {
    if (fetchedEnrichment) setEnrichment(fetchedEnrichment as EnrichmentData);
  }, [fetchedEnrichment]);

  // Fetch upcoming shows
  useEffect(() => {
    if (!data?.name || showsLoaded) return;
    api<{ events: ArtistShowEvent[]; configured: boolean }>(`/api/artist/${encPath(data.name)}/shows`)
      .then((d) => { setUpcomingShows(d.events || []); setShowsLoaded(true); })
      .catch(() => setShowsLoaded(true));
  }, [data?.name]);

  // Fetch all track titles for setlist matching (lazy)
  useEffect(() => {
    if (!data?.name || activeTab !== "setlist" || allTrackTitles.length > 0) return;
    api<{ title: string; album: string; path: string }[]>(`/api/artist/${encPath(data.name)}/track-titles`)
      .then((d) => { if (Array.isArray(d)) setAllTrackTitles(d); })
      .catch(() => {});
  }, [data?.name, activeTab]);

  // Fetch missing albums (lazy, on discography tab)
  useEffect(() => {
    if (!data?.name || activeTab !== "discography" || missingLoaded) return;
    let cancelled = false;
    api<{ missing: { title: string; first_release_date: string; type: string }[] }>(`/api/missing/${encPath(data.name)}`)
      .then((d) => { if (!cancelled) { setMissingAlbums(d.missing ?? []); setMissingLoaded(true); } })
      .catch(() => { if (!cancelled) setMissingLoaded(true); });
    return () => { cancelled = true; };
  }, [data?.name, activeTab, missingLoaded]);

  // Fetch Tidal missing albums (lazy, on discography tab)
  useEffect(() => {
    if (!data?.name || activeTab !== "discography" || tidalMissingLoaded) return;
    api<{ albums: typeof tidalMissing; authenticated: boolean }>(`/api/tidal/missing/${encPath(data.name)}`)
      .then((d) => { if (d.albums) setTidalMissing(d.albums); setTidalMissingLoaded(true); })
      .catch(() => setTidalMissingLoaded(true));
  }, [data?.name, activeTab, tidalMissingLoaded]);

  if (loading) return <ArtistLoadingState />;

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const artistName = data.name;
  const totalTracks = data.total_tracks ?? data.albums.reduce((s, a) => s + a.tracks, 0);
  const totalSize = data.total_size_mb ?? data.albums.reduce((s, a) => s + a.size_mb, 0);
  const letter = artistName.charAt(0).toUpperCase();
  const issueCount = data.issue_count ?? 0;

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

  function playTopTrack(_track: TopTrack, index: number) {
    const tracks: PlayerTrack[] = topTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : `/api/artist/${encPath(t.artist)}/photo`,
    }));
    player.playAll(tracks, index);
  }

  const mergedSimilar = buildMergedSimilarArtists(enrichment);
  const externalLinks = buildExternalLinks(enrichment, navidromeLink?.navidrome_url);
  const tabs = buildArtistTabs(upcomingShows.length);
  const activeMembers = mb?.members?.filter((m) => !m.end) ?? [];
  const popularityScore = computePopularityScore(spotify?.popularity, lastfm?.listeners);

  async function playArtistRadio() {
    try {
      const tracks = await api<{ path: string; title: string; artist: string; album: string }[]>(
        `/api/artist-radio/${encPath(artistName)}?limit=50`,
      );
      if (Array.isArray(tracks) && tracks.length > 0) {
        const playerTracks = tracks.map((track) => ({
          id: track.path,
          title: track.title,
          artist: track.artist,
          albumCover: track.album ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}` : undefined,
        }));
        player.playAll(playerTracks, 0);
        toast.success(`Artist Radio: ${tracks.length} tracks`);
      } else {
        toast.error("No bliss data — run audio analysis first");
      }
    } catch {
      toast.error("Artist Radio not available");
    }
  }

  async function enrichArtist() {
    setEnriching(true);
    try {
      const res = await api<{ status: string; task_id: string }>(`/api/artist/${encPath(artistName)}/enrich`, "POST");
      toast.success("Enrichment started", { description: "This may take a moment..." });
      const taskId = res.task_id;
      const poll = setInterval(async () => {
        try {
          const task = await api<{ status: string }>(`/api/tasks/${taskId}`);
          if (task.status === "completed") {
            clearInterval(poll);
            setEnriching(false);
            toast.success("Artist enriched!");
            window.location.reload();
          } else if (task.status === "failed") {
            clearInterval(poll);
            setEnriching(false);
            toast.error("Enrichment failed");
          }
        } catch {
          // Keep polling while the task endpoint is reachable.
        }
      }, 3000);
      setTimeout(() => {
        clearInterval(poll);
        setEnriching(false);
      }, 120000);
    } catch {
      setEnriching(false);
      toast.error("Failed to start enrichment");
    }
  }

  async function analyzeArtist() {
    try {
      await api(`/api/analyze/artist/${encPath(artistName)}`, "POST");
      toast.success("Analysis queued", { description: "Background daemons will process the tracks." });
    } catch {
      toast.error("Failed to queue analysis");
    }
  }

  async function repairArtist() {
    try {
      await api(`/api/manage/repair-artist/${encPath(artistName)}`, "POST");
      toast.success(`Repair started for ${issueCount} issue${issueCount !== 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to start repair");
    }
  }

  async function downloadMissingDiscography() {
    setDownloadingDiscog(true);
    try {
      const res = await api<{ queued: number }>(`/api/tidal/download-missing/${encPath(artistName)}`, "POST", {
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

  return (
    <div className="-mt-16 md:-mt-[6.5rem]">
      <ArtistHeroSection
        artistName={artistName}
        letter={letter}
        albumCount={data.albums.length}
        totalTracks={totalTracks}
        totalSizeMb={totalSize}
        issueCount={issueCount}
        musicbrainz={mb}
        lastfmListeners={lastfm?.listeners}
        upcomingShow={upcomingShows[0]}
        popularityScore={popularityScore}
        tags={allTags}
        navidromeUrl={navidromeLink?.navidrome_url}
        topTracksAvailable={topTracks.length > 0}
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
        onPlayTopTracks={() => {
          if (topTracks[0]) playTopTrack(topTracks[0], 0);
        }}
        onPlayRadio={() => {
          void playArtistRadio();
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
        onDelete={() => setShowDeleteConfirm(true)}
      />

      <ArtistTabsNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* ═══ CONTENT ═══ */}
      <div className="px-4 md:px-8 pt-6 pb-12 max-w-[1100px]">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <ArtistOverviewSection
            bioText={bioText}
            bioExpanded={bioExpanded}
            onToggleBioExpanded={() => setBioExpanded(!bioExpanded)}
            topTracks={topTracks}
            currentTrackId={player.queue[player.currentIndex]?.id}
            trackPlaying={isTrackPlaying()}
            onPause={() => player.pause()}
            onResume={() => player.resume()}
            onPlayTopTrack={playTopTrack}
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
              currentTrackId={player.queue[player.currentIndex]?.id}
              trackPlaying={isTrackPlaying()}
              onPause={() => player.pause()}
              onResume={() => player.resume()}
              onPlayTopTrack={playTopTrack}
            />
          </div>
        )}

        {/* ── Discography Tab ── */}
        {activeTab === "discography" && (
          <ArtistDiscographySection
            artistName={artistName}
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
            setlistData={setlistData}
            allTrackTitles={allTrackTitles}
            onTrackTitlesLoaded={setAllTrackTitles}
            onPlayTrack={(track) => player.play(track)}
            onPlayAll={(tracks) => player.playAll(tracks)}
          />
        )}

        {/* ── Shows Tab ── */}
        {activeTab === "shows" && (
          <ArtistShowsSection artistName={artistName} shows={upcomingShows} />
        )}

        {/* ── Similar Artists Tab ── */}
        {activeTab === "similar" && (
          <ArtistSimilarSection artistName={artistName} artists={mergedSimilar} />
        )}

        {/* ── Stats Tab ── */}
        {activeTab === "stats" && (
          <ArtistStatsSection artistName={artistName} />
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
            await api(`/api/manage/artist/${encPath(data!.name)}/delete`, "POST", { mode: "full" });
            toast.success(`Artist ${data!.name} deleted`);
            window.location.href = "/browse";
          } catch {
            toast.error("Failed to delete artist");
          }
        }}
      />
    </div>
  );
}
