import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { useApi } from "@/hooks/use-api";
import { ArtistStats } from "@/components/artist/ArtistStats";
import { useNavidromeLink, useTopTracks, useArtistEnrichment } from "@/hooks/use-artist-data";
import { api } from "@/lib/api";
import { AlbumCard } from "@/components/album/AlbumCard";
import { Network } from "@nivo/network";
import { MusicContextMenu } from "@/components/ui/music-context-menu";
import { MissingAlbumCard } from "@/components/album/MissingAlbumCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlayer, type Track as PlayerTrack } from "@/contexts/PlayerContext";
import {
  encPath,
  formatSize,
  formatNumber,
  formatCompact,
  formatDuration,
  formatDurationMs,
} from "@/lib/utils";
import {
  Play,
  Pause,
  ExternalLink,
  Headphones,
  Disc3,
  Music,
  HardDrive,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  RefreshCw,
  Globe,
  Users,
  Calendar,
  MapPin,
  BarChart3,
  ListMusic,
  Trash2,
  Radio,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ── Types ──

interface ArtistData {
  name: string;
  albums: {
    name: string;
    display_name?: string;
    tracks: number;
    formats: string[];
    size_mb: number;
    year: string;
    has_cover: boolean;
  }[];
  genres?: string[];
  total_tracks?: number;
  total_size_mb?: number;
  primary_format?: string;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
  listeners?: number;
}

interface EnrichmentData {
  lastfm?: {
    bio?: string;
    tags?: string[];
    similar?: { name: string }[];
    listeners?: number;
    playcount?: number;
    url?: string;
  };
  spotify?: {
    popularity?: number;
    followers?: number;
    genres?: string[];
    top_tracks?: {
      name: string;
      album: string;
      duration_ms: number;
      popularity: number;
      preview_url?: string;
    }[];
    related_artists?: {
      name: string;
      images?: { url: string }[];
      genres?: string[];
      popularity?: number;
    }[];
    url?: string;
  };
  setlist?: {
    probable_setlist?: {
      title: string;
      frequency: number;
      play_count: number;
      last_played?: string;
    }[];
    total_shows?: number;
    last_show?: { date: string; venue: string; city: string };
  };
  musicbrainz?: {
    type?: string;
    begin_date?: string;
    country?: string;
    area?: string;
    members?: {
      name: string;
      type: string;
      begin?: string;
      end?: string | null;
      attributes?: string[];
    }[];
    urls?: Record<string, string>;
  };
  fanart?: {
    backgrounds?: string[];
    thumbs?: string[];
    logos?: string[];
    banners?: string[];
  };
}

type TabKey = "overview" | "top-tracks" | "discography" | "setlist" | "similar" | "stats" | "about";

// ── Main Component ──

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : "";
  const { data, loading } = useApi<ArtistData>(
    name ? `/api/artist/${encPath(decodedName)}` : null,
  );
  const player = usePlayer();
  const navigate = useNavigate();

  const [sort, setSort] = useState("name");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [bgLoaded, setBgLoaded] = useState(false);
  // Data fetching hooks (replace manual useEffect + useState)
  const navidromeLink = useNavidromeLink(data?.name);
  const topTracks = useTopTracks(data?.name);
  const [enriching, setEnriching] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showMissing, setShowMissing] = useState(true);
  const [missingAlbums, setMissingAlbums] = useState<{ title: string; first_release_date: string; type: string }[]>([]);
  const [missingLoaded, setMissingLoaded] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const { enrichment: fetchedEnrichment, loading: enrichmentLoading } = useArtistEnrichment(data?.name);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { isAdmin } = useAuth();
  const bgRef = useRef<HTMLImageElement>(null);

  // Sync enrichment from hook (can be overridden by manual enrich)
  useEffect(() => {
    if (fetchedEnrichment) setEnrichment(fetchedEnrichment as EnrichmentData);
  }, [fetchedEnrichment]);

  // Fetch missing albums (lazy, on discography tab)
  useEffect(() => {
    if (!data?.name || activeTab !== "discography" || missingLoaded) return;
    let cancelled = false;
    api<{ missing: { title: string; first_release_date: string; type: string }[] }>(`/api/missing/${encPath(data.name)}`)
      .then((d) => { if (!cancelled) { setMissingAlbums(d.missing ?? []); setMissingLoaded(true); } })
      .catch(() => { if (!cancelled) setMissingLoaded(true); });
    return () => { cancelled = true; };
  }, [data?.name, activeTab, missingLoaded]);

  if (loading) {
    return (
      <div className="-mx-8 -mt-8">
        <div className="h-[360px] bg-card animate-pulse" />
        <div className="px-8 pt-6">
          <div className="flex gap-2 mb-6">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9 w-28" />)}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-3">
                <Skeleton className="w-full aspect-square rounded-md mb-2" />
                <Skeleton className="h-4 w-3/4 mb-1" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data) return <div className="text-center py-12 text-muted-foreground">Not found</div>;

  const totalTracks = data.total_tracks ?? data.albums.reduce((s, a) => s + a.tracks, 0);
  const totalSize = data.total_size_mb ?? data.albums.reduce((s, a) => s + a.size_mb, 0);
  const letter = data.name.charAt(0).toUpperCase();

  const sortedAlbums = [...data.albums].sort((a, b) => {
    if (sort === "year") return (b.year || "").localeCompare(a.year || "");
    if (sort === "tracks") return b.tracks - a.tracks;
    return a.name.localeCompare(b.name);
  });

  // Merge genres from all sources
  const allTags = (() => {
    const seen = new Set<string>();
    const result: string[] = [];
    const raw = [
      ...(data.genres ?? []),
      ...(enrichment?.lastfm?.tags ?? []),
      ...(enrichment?.spotify?.genres ?? []),
    ];
    // Split comma-separated genres into individual tags
    for (const t of raw) {
      for (const part of t.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (!seen.has(lower)) { seen.add(lower); result.push(trimmed); }
      }
    }
    return result;
  })();

  const bioText = enrichment?.lastfm?.bio ?? "";
  const mb = enrichment?.musicbrainz;
  const spotify = enrichment?.spotify;
  const lastfm = enrichment?.lastfm;
  const setlistData = enrichment?.setlist;

  function playTopTrack(_track: TopTrack, index: number) {
    const tracks: PlayerTrack[] = topTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : `/api/artist/${encPath(t.artist)}/photo`,
    }));
    player.playAll(tracks, index);
  }

  // Merge similar artists from Last.fm + Spotify related
  const mergedSimilar = (() => {
    const seen = new Set<string>();
    const result: { name: string; image?: string; genres?: string[]; popularity?: number }[] = [];
    for (const a of (spotify?.related_artists ?? [])) {
      const lower = a.name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push({
          name: a.name,
          image: a.images?.[0]?.url,
          genres: a.genres,
          popularity: a.popularity,
        });
      }
    }
    for (const a of (lastfm?.similar ?? [])) {
      const lower = a.name.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push({ name: a.name });
      }
    }
    return result;
  })();

  // External links
  const externalLinks = (() => {
    const links: { label: string; url: string; color: string }[] = [];
    if (spotify?.url) links.push({ label: "Spotify", url: spotify.url, color: "text-green-400" });
    if (lastfm?.url) links.push({ label: "Last.fm", url: lastfm.url, color: "text-red-400" });
    if (mb?.urls?.wikipedia) links.push({ label: "Wikipedia", url: mb.urls.wikipedia, color: "text-white/60" });
    if (mb?.urls?.official) links.push({ label: "Official", url: mb.urls.official, color: "text-blue-400" });
    if (mb?.urls?.instagram) links.push({ label: "Instagram", url: mb.urls.instagram, color: "text-pink-400" });
    if (mb?.urls?.spotify && !spotify?.url) links.push({ label: "Spotify", url: mb.urls.spotify, color: "text-green-400" });
    if (navidromeLink?.navidrome_url) links.push({ label: "Navidrome", url: navidromeLink.navidrome_url, color: "text-cyan-400" });
    return links;
  })();

  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "top-tracks", label: "Top Tracks" },
    { key: "discography", label: "Discography" },
    { key: "setlist", label: "Probable Setlist" },
    { key: "similar", label: "Similar Artists" },
    { key: "stats", label: "Stats" },
    { key: "about", label: "About" },
  ];

  const activeMembers = mb?.members?.filter((m) => !m.end) ?? [];

  return (
    <div className="-mt-16 md:-mt-[6.5rem]">
      {/* ═══ HERO BANNER — full viewport width ═══ */}
      <div
        className="relative h-[420px] md:h-[560px] overflow-hidden -mx-4 md:-mx-8"
        style={{ width: "calc(100vw - var(--sidebar-w, 0px))" }}
      >
        <img
          ref={bgRef}
          src={`/api/artist/${encPath(data.name)}/background?random=true`}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover object-[right_20%] transition-opacity duration-1000 ${bgLoaded ? "opacity-60" : "opacity-0"}`}
          onLoad={() => setBgLoaded(true)}
          onError={() => {}}
        />
        {/* Left gradient — solid to transparent for text readability */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(to right, #2e3440 0%, rgba(46,52,64,0.85) 25%, rgba(46,52,64,0.4) 50%, transparent 75%)",
        }} />
        {/* Bottom gradient — long smooth fade into page background */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(to top, #2e3440 0%, rgba(46,52,64,0.9) 15%, rgba(46,52,64,0.4) 40%, transparent 70%)",
        }} />
        {/* Top vignette — subtle darkening */}
        <div className="absolute inset-0" style={{
          background: "linear-gradient(to bottom, rgba(46,52,64,0.5) 0%, transparent 30%)",
        }} />

        <div className="absolute inset-0 flex items-end">
          <div className="flex items-end gap-4 md:gap-6 w-full max-w-[1100px] px-4 md:px-8 pb-6 md:pb-8">
            {/* Artist photo */}
            <div className="w-[150px] h-[150px] md:w-[200px] md:h-[200px] rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-white/10 shadow-2xl shadow-black/50">
              {!photoError ? (
                <img
                  src={`/api/artist/${encPath(data.name)}/photo?random=true`}
                  alt={data.name}
                  className={`w-full h-full object-cover transition-opacity duration-500 ${photoLoaded ? "opacity-100" : "opacity-0"}`}
                  onLoad={() => setPhotoLoaded(true)}
                  onError={() => setPhotoError(true)}
                />
              ) : null}
              {(photoError || !photoLoaded) && (
                <div className={`w-full h-full bg-gradient-to-br from-cyan-600/40 to-cyan-900/20 flex items-center justify-center ${photoLoaded && !photoError ? "hidden" : ""}`}>
                  <span className="text-5xl font-black text-white/40">{letter}</span>
                </div>
              )}
            </div>

            {/* Artist info */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="text-xs text-white/40 mb-2">
                <Link to="/browse" className="hover:text-white/70 transition-colors">Browse</Link>
                <span className="mx-1.5">/</span>
                <span className="text-white/60">{data.name}</span>
              </div>

              <h1 className="text-2xl md:text-5xl font-black tracking-tight text-white leading-none mb-2 truncate">
                {data.name}
              </h1>

              {/* Origin + formation year */}
              {(mb?.country || mb?.begin_date) && (
                <div className="hidden md:flex items-center gap-3 text-sm text-white/50 mb-2">
                  {mb?.country && (
                    <span className="flex items-center gap-1"><MapPin size={13} />{mb.area ? `${mb.area}, ` : ""}{mb.country}</span>
                  )}
                  {mb?.begin_date && (
                    <span className="flex items-center gap-1"><Calendar size={13} />Est. {mb.begin_date}</span>
                  )}
                  {mb?.type && (
                    <span className="flex items-center gap-1"><Users size={13} />{mb.type}</span>
                  )}
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-2 md:gap-4 text-xs md:text-sm text-white/50 mb-2 flex-wrap">
                <span className="flex items-center gap-1.5"><Disc3 size={14} />{data.albums.length} albums</span>
                <span className="flex items-center gap-1.5"><Music size={14} />{formatNumber(totalTracks)} tracks</span>
                <span className="flex items-center gap-1.5"><HardDrive size={14} />{formatSize(totalSize)}</span>
                {lastfm && (lastfm.listeners ?? 0) > 0 && (
                  <span className="flex items-center gap-1.5"><Headphones size={14} />{formatCompact(lastfm.listeners!)} listeners</span>
                )}
              </div>

              {/* Popularity bar — Spotify or derived from Last.fm listeners */}
              {(() => {
                const pop = spotify?.popularity;
                const listeners = lastfm?.listeners;
                // Use Spotify if available, otherwise derive from listeners (log scale, cap at 100)
                // Spotify: 0-100 already. Last.fm: natural log scale 5K=0% to 50M=100%
                let score = 0;
                if (pop && pop > 0) {
                  score = pop;
                } else if (listeners && listeners > 5000) {
                  const minL = Math.log(5000);
                  const maxL = Math.log(50000000);
                  score = Math.min(100, Math.max(1, Math.round((Math.log(listeners) - minL) / (maxL - minL) * 100)));
                }
                return score > 0 ? (
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs text-white/40">Popularity</span>
                    <div className="w-[60px] h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${score}%`, background: "linear-gradient(90deg, #6b7280, #22c55e)" }} />
                    </div>
                    <span className="text-xs text-white/40">{score}%</span>
                  </div>
                ) : null;
              })()}

              {/* Tags */}
              {allTags.length > 0 && (
                <div className="hidden md:flex gap-1.5 flex-wrap mb-3">
                  {allTags.slice(0, 8).map((g) => (
                    <span key={g} className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">
                      {g.toLowerCase()}
                    </span>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {topTracks.length > 0 && (
                  <Button
                    size="sm"
                    className="bg-cyan-600 hover:bg-cyan-500 text-white"
                    onClick={() => topTracks[0] && playTopTrack(topTracks[0], 0)}
                  >
                    <Play size={14} className="mr-1 fill-current" /> Play Top Tracks
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                  onClick={async () => {
                    try {
                      const tracks = await api<{ path: string; title: string; artist: string; album: string }[]>(`/api/artist-radio/${encPath(data.name)}?limit=50`);
                      if (Array.isArray(tracks) && tracks.length > 0) {
                        const playerTracks = tracks.map((t) => ({
                          id: t.path,
                          title: t.title,
                          artist: t.artist,
                          albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined,
                        }));
                        player.playAll(playerTracks, 0);
                        toast.success(`Artist Radio: ${tracks.length} tracks`);
                      } else {
                        toast.error("No bliss data — run audio analysis first");
                      }
                    } catch { toast.error("Artist Radio not available"); }
                  }}
                >
                  <Radio size={14} className="mr-1" /> Artist Radio
                </Button>
                {navidromeLink?.navidrome_url && (
                  <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                    <a href={navidromeLink.navidrome_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} className="mr-1" /> Navidrome
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                  disabled={enriching}
                  onClick={async () => {
                    setEnriching(true);
                    try {
                      const res = await api<{ status: string; task_id: string }>(`/api/artist/${encPath(data.name)}/enrich`, "POST");
                      toast.success("Enrichment started", { description: "This may take a moment..." });
                      // Poll task status
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
                        } catch { /* keep polling */ }
                      }, 3000);
                      // Timeout after 2 min
                      setTimeout(() => { clearInterval(poll); setEnriching(false); }, 120000);
                    } catch { setEnriching(false); toast.error("Failed to start enrichment"); }
                  }}
                >
                  <RefreshCw size={14} className={`mr-1 ${enriching ? "animate-spin" : ""}`} /> {enriching ? "Enriching..." : "Enrich"}
                </Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    <Trash2 size={14} className="mr-1" /> Delete
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ TABS ═══ */}
      <div className="border-b border-border sticky top-0 bg-[#2e3440]/95 backdrop-blur-sm z-10 px-4 md:px-8">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 scrollbar-none" style={{ scrollbarWidth: "none" }}>
        <div className="flex gap-1 -mb-px min-w-max">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 md:px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === t.key
                  ? "border-cyan-500 text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="px-4 md:px-8 pt-6 pb-12 max-w-[1100px]">

        {/* ── Overview Tab ── */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Bio */}
            {bioText && (
              <div className="max-w-3xl">
                <h3 className="text-sm font-semibold text-white/70 mb-2">Biography</h3>
                <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
                  {bioExpanded ? bioText : bioText.slice(0, 400)}
                  {!bioExpanded && bioText.length > 400 && "..."}
                </p>
                {bioText.length > 400 && (
                  <button
                    onClick={() => setBioExpanded(!bioExpanded)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 mt-2 flex items-center gap-1"
                  >
                    {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
                  </button>
                )}
              </div>
            )}

            {/* Top 5 Tracks mini-list */}
            {topTracks.length > 0 && (
              <div className="max-w-2xl">
                <h3 className="text-sm font-semibold text-white/70 mb-2">Top Tracks</h3>
                <div className="space-y-0.5">
                  {topTracks.slice(0, 5).map((track, i) => {
                    const isCurrent = player.queue[player.currentIndex]?.id === track.id;
                    const isCurrentPlaying = isCurrent && player.isPlaying;
                    return (
                      <MusicContextMenu key={track.id} type="track" artist={track.artist} album={track.album || ""} trackId={track.id} trackTitle={track.title}
                        albumCover={track.album ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}` : undefined}>
                      <button
                        onClick={() => {
                          if (isCurrentPlaying) player.pause();
                          else if (isCurrent) player.resume();
                          else playTopTrack(track, i);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group text-left ${isCurrent ? "bg-white/[0.03]" : ""}`}
                      >
                        {isCurrent ? (
                          isCurrentPlaying ? <Pause size={13} className="text-cyan-400 w-5 fill-current" /> : <Play size={13} className="text-cyan-400 w-5 fill-current" />
                        ) : (
                          <>
                            <span className="w-5 text-right text-xs text-white/30 group-hover:hidden">{i + 1}</span>
                            <Play size={13} className="text-cyan-400 hidden group-hover:block w-5 fill-current" />
                          </>
                        )}
                        <span className={`flex-1 text-sm truncate ${isCurrent ? "text-cyan-400" : "text-white/80"}`}>{track.title}</span>
                        <span className="text-xs text-white/30">{formatDuration(track.duration)}</span>
                      </button>
                      </MusicContextMenu>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick stats grid */}
            <div>
              <h3 className="text-sm font-semibold text-white/70 mb-3">Stats</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-3xl">
                {mb?.type && <StatCard label="Type" value={mb.type} icon={<Users size={14} />} />}
                {mb?.begin_date && <StatCard label="Formed" value={mb.begin_date} icon={<Calendar size={14} />} />}
                {mb?.country && <StatCard label="Country" value={mb.country} icon={<MapPin size={14} />} />}
                {activeMembers.length > 0 && <StatCard label="Active Members" value={String(activeMembers.length)} icon={<Users size={14} />} />}
                {(lastfm?.listeners ?? 0) > 0 && <StatCard label="Listeners" value={formatCompact(lastfm!.listeners!)} icon={<Headphones size={14} />} />}
                {(spotify?.followers ?? 0) > 0 && <StatCard label="Followers" value={formatCompact(spotify!.followers!)} icon={<Users size={14} />} />}
                {(spotify?.popularity ?? 0) > 0 && <StatCard label="Popularity" value={`${spotify!.popularity}%`} icon={<BarChart3 size={14} />} />}
                {(lastfm?.playcount ?? 0) > 0 && <StatCard label="Scrobbles" value={formatCompact(lastfm!.playcount!)} icon={<Music size={14} />} />}
              </div>
            </div>

            {/* External links */}
            {externalLinks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-3">Links</h3>
                <div className="flex gap-2 flex-wrap">
                  {externalLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors ${link.color}`}
                    >
                      <Globe size={12} /> {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {enrichmentLoading && (
              <div className="space-y-3 max-w-3xl">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            )}
          </div>
        )}

        {/* ── Top Tracks Tab ── */}
        {activeTab === "top-tracks" && (
          <div className="max-w-4xl">
            {topTracks.length === 0 && !(spotify?.top_tracks?.length) ? (
              <div className="text-center py-12 text-muted-foreground">No top tracks available</div>
            ) : (
              <div>
                {/* Header row */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs text-white/30 border-b border-white/5 mb-1">
                  <span className="w-8 text-right">#</span>
                  <span className="flex-1">Title</span>
                  <span className="w-32 hidden sm:block">Album</span>
                  <span className="w-20 text-right">Duration</span>
                  <span className="w-20 text-right hidden sm:block">Popularity</span>
                  <span className="w-8" />
                </div>
                <div className="space-y-0.5">
                  {/* Navidrome top tracks first */}
                  {topTracks.map((track, i) => {
                    const isCurrent = player.queue[player.currentIndex]?.id === track.id;
                    const isCurrentPlaying = isCurrent && player.isPlaying;
                    return (
                      <MusicContextMenu key={`nd-${track.id}`} type="track" artist={track.artist} album={track.album || ""} trackId={track.id} trackTitle={track.title}
                        albumCover={track.album ? `/api/cover/${encPath(track.artist)}/${encPath(track.album)}` : undefined}>
                      <button
                        onClick={() => {
                          if (isCurrentPlaying) player.pause();
                          else if (isCurrent) player.resume();
                          else playTopTrack(track, i);
                        }}
                        className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-lg hover:bg-white/5 transition-colors group text-left ${isCurrent ? "bg-white/[0.03]" : ""}`}
                      >
                        {isCurrent ? (
                          isCurrentPlaying ? <Pause size={14} className="text-cyan-400 w-8 text-right fill-current" /> : <Play size={14} className="text-cyan-400 w-8 text-right fill-current" />
                        ) : (
                          <>
                            <span className="w-8 text-right text-sm text-white/30 group-hover:hidden">{i + 1}</span>
                            <Play size={14} className="text-cyan-400 hidden group-hover:block w-8 text-right fill-current" />
                          </>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isCurrent ? "text-cyan-400" : "text-white/90"}`}>{track.title}</div>
                        </div>
                        <div className="w-32 hidden sm:block text-xs text-white/40 truncate">{track.album}</div>
                        <div className="w-20 text-right text-xs text-white/30">{formatDuration(track.duration)}</div>
                        <div className="w-20 text-right hidden sm:block">
                          {track.listeners ? (
                            <span className="text-xs text-white/30">{formatCompact(track.listeners)}</span>
                          ) : null}
                        </div>
                        <div className="w-8" />
                      </button>
                      </MusicContextMenu>
                    );
                  })}
                  {/* Spotify-only tracks (not in Navidrome) */}
                  {spotify?.top_tracks?.filter(
                    (st) => !topTracks.some((t) => t.title.toLowerCase() === st.name.toLowerCase())
                  ).map((st, i) => (
                    <div
                      key={`sp-${i}`}
                      className="w-full flex items-center gap-4 px-4 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left opacity-60"
                    >
                      <span className="w-8 text-right text-sm text-white/30">{topTracks.length + i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white/70 truncate">{st.name}</div>
                      </div>
                      <div className="w-32 hidden sm:block text-xs text-white/40 truncate">{st.album}</div>
                      <div className="w-20 text-right text-xs text-white/30">{formatDurationMs(st.duration_ms)}</div>
                      <div className="w-20 text-right hidden sm:block">
                        <PopularityBar value={st.popularity} />
                      </div>
                      <div className="w-8" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Discography Tab ── */}
        {activeTab === "discography" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold">{data.albums.length} Albums</h2>
                {missingAlbums.length > 0 && (
                  <button
                    onClick={() => setShowMissing(!showMissing)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showMissing ? <Eye size={14} /> : <EyeOff size={14} />}
                    {showMissing ? "Hide" : "Show"} missing ({missingAlbums.length})
                  </button>
                )}
              </div>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[140px] bg-card border-border h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="year">Newest</SelectItem>
                  <SelectItem value="tracks">Most Tracks</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
              {(() => {
                type GridItem = { kind: "local"; album: typeof sortedAlbums[0] } | { kind: "missing"; album: typeof missingAlbums[0] };
                const items: GridItem[] = sortedAlbums.map((a) => ({ kind: "local" as const, album: a }));
                if (showMissing) {
                  for (const m of missingAlbums) {
                    items.push({ kind: "missing" as const, album: m });
                  }
                }
                if (sort === "year") {
                  items.sort((a, b) => {
                    const ya = a.kind === "local" ? (a.album.year || "") : (a.album.first_release_date || "");
                    const yb = b.kind === "local" ? (b.album.year || "") : (b.album.first_release_date || "");
                    return yb.localeCompare(ya);
                  });
                }
                return items.map((item) =>
                  item.kind === "local" ? (
                    <AlbumCard
                      key={`local-${item.album.name}`}
                      artist={data.name}
                      name={item.album.name}
                      displayName={item.album.display_name}
                      year={item.album.year}
                      tracks={item.album.tracks}
                      formats={item.album.formats}
                      hasCover={item.album.has_cover}
                    />
                  ) : (
                    <MissingAlbumCard
                      key={`missing-${item.album.title}`}
                      title={item.album.title}
                      year={item.album.first_release_date}
                      type={item.album.type}
                    />
                  ),
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Probable Setlist Tab ── */}
        {activeTab === "setlist" && (
          <div className="max-w-3xl">
            {!setlistData?.probable_setlist?.length ? (
              <div className="text-center py-12 text-muted-foreground">
                No concert data available from Setlist.fm
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">Probable Setlist</h2>
                    <p className="text-xs text-white/40 mt-0.5">
                      Based on {setlistData.total_shows ?? 0} recent concerts
                      {setlistData.last_show && (
                        <> &middot; Last show: {setlistData.last_show.date} at {setlistData.last_show.venue}, {setlistData.last_show.city}</>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-cyan-600 hover:bg-cyan-500 text-white"
                      onClick={() => {
                        if (!setlistData?.probable_setlist) return;
                        // Match setlist songs to local top tracks for playback
                        const matched: PlayerTrack[] = [];
                        for (const song of setlistData.probable_setlist) {
                          const t = topTracks.find((tt) => tt.title.toLowerCase() === song.title.toLowerCase());
                          if (t) {
                            matched.push({
                              id: t.id,
                              title: t.title,
                              artist: t.artist,
                              album: t.album,
                              albumCover: t.album ? `/api/cover/${encPath(t.artist)}/${encPath(t.album)}` : undefined,
                            });
                          }
                        }
                        if (matched.length > 0) {
                          player.playAll(matched);
                          toast.success(`Playing setlist: ${matched.length} tracks`);
                        } else {
                          toast.error("No tracks matched from library");
                        }
                      }}
                    >
                      <Play size={14} className="mr-1 fill-current" /> Play Setlist
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-white/20 text-white/70 hover:text-white hover:bg-white/10"
                      onClick={async () => {
                        try {
                          await api(`/api/artist/${encPath(data.name)}/setlist-playlist`, "POST");
                          toast.success("Setlist playlist created in Navidrome");
                        } catch {
                          toast.error("Failed to create playlist");
                        }
                      }}
                    >
                      <ListMusic size={14} className="mr-1" /> Save as Playlist
                    </Button>
                  </div>
                </div>

                {/* Header */}
                <div className="flex items-center gap-4 px-4 py-2 text-xs text-white/30 border-b border-white/5 mb-1">
                  <span className="w-8 text-right">#</span>
                  <span className="flex-1">Song</span>
                  <span className="w-28">Frequency</span>
                  <span className="w-16 text-right">Plays</span>
                  <span className="w-24 text-right hidden sm:block">Last Played</span>
                </div>

                <div className="space-y-0.5">
                  {setlistData.probable_setlist.map((song, i) => {
                    const matchedTrack = topTracks.find((t) => t.title.toLowerCase() === song.title.toLowerCase());
                    const isPlayable = !!matchedTrack;
                    return (
                    <button
                      key={i}
                      className={`w-full flex items-center gap-4 px-4 py-2.5 rounded-lg hover:bg-white/5 transition-colors text-left group ${!isPlayable ? "opacity-50" : ""}`}
                      onClick={() => {
                        if (matchedTrack) {
                          player.play({
                            id: matchedTrack.id,
                            title: matchedTrack.title,
                            artist: matchedTrack.artist,
                            album: matchedTrack.album,
                            albumCover: matchedTrack.album ? `/api/cover/${encPath(matchedTrack.artist)}/${encPath(matchedTrack.album)}` : undefined,
                          });
                        }
                      }}
                      disabled={!isPlayable}
                    >
                      {isPlayable ? (
                        <>
                          <span className="w-8 text-right text-sm text-white/30 group-hover:hidden">{i + 1}</span>
                          <Play size={13} className="text-cyan-400 w-8 text-right fill-current hidden group-hover:block" />
                        </>
                      ) : (
                        <span className="w-8 text-right text-sm text-white/20">{i + 1}</span>
                      )}
                      <span className="flex-1 text-sm text-white/90 truncate">{song.title}</span>
                      <div className="w-28 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round(song.frequency * 100)}%`,
                              background: "linear-gradient(90deg, #88c0d0, #81a1c1)",
                            }}
                          />
                        </div>
                        <span className="text-xs text-white/40 w-8 text-right">{Math.round(song.frequency * 100)}%</span>
                      </div>
                      <span className="w-16 text-right text-xs text-white/40">{song.play_count}</span>
                      <span className="w-24 text-right text-xs text-white/30 hidden sm:block">{song.last_played ?? "-"}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Similar Artists Tab ── */}
        {activeTab === "similar" && (
          <div>
            {mergedSimilar.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No similar artists available</div>
            ) : (
              <>
                {/* Network Graph */}
                <div className="bg-card border border-border rounded-lg p-4 mb-6">
                  <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
                  <ArtistNetworkGraph
                    centerArtist={data.name}
                    similar={mergedSimilar.map((s) => s.name)}
                    onNodeClick={(name) => navigate(`/artist/${encPath(name)}`)}
                    onDownload={(name) => navigate(`/download?q=${encodeURIComponent(name)}`)}
                  />
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
                  {mergedSimilar.map((s) => (
                    <SimilarArtistCard
                      key={s.name}
                      name={s.name}
                      genres={s.genres}
                      popularity={s.popularity}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Stats Tab ── */}
        {activeTab === "stats" && (
          <div className="space-y-6">
            <ArtistStats name={data.name} />
            {mergedSimilar.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="text-sm font-semibold mb-3">Artist Network</h4>
                <ArtistNetworkGraph
                  centerArtist={data.name}
                  similar={mergedSimilar.map((s) => s.name)}
                  onNodeClick={(name) => navigate(`/artist/${encPath(name)}`)}
                  onDownload={(name) => navigate(`/download?q=${encodeURIComponent(name)}`)}
                />
              </div>
            )}
          </div>
        )}

        {/* ── About Tab ── */}
        {activeTab === "about" && (
          <div className="max-w-3xl space-y-8">
            {/* Full bio */}
            {bioText && (
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-2">Biography</h3>
                <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
                  {bioExpanded ? bioText : bioText.slice(0, 600)}
                  {!bioExpanded && bioText.length > 600 && "..."}
                </p>
                {bioText.length > 600 && (
                  <button
                    onClick={() => setBioExpanded(!bioExpanded)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 mt-2 flex items-center gap-1"
                  >
                    {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
                  </button>
                )}
              </div>
            )}

            {/* Members */}
            {mb?.members && mb.members.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-3">Members</h3>
                <div className="space-y-2">
                  {mb.members.map((m, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                      <div>
                        <span className="text-sm text-white/80">{m.name}</span>
                        {m.attributes && m.attributes.length > 0 && (
                          <span className="text-xs text-white/40 ml-2">{m.attributes.join(", ")}</span>
                        )}
                      </div>
                      <span className="text-xs text-white/30">
                        {m.begin ?? "?"} - {m.end ?? "present"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Big numbers */}
            <div>
              <h3 className="text-sm font-semibold text-white/70 mb-3">Numbers</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(lastfm?.listeners ?? 0) > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{formatCompact(lastfm!.listeners!)}</div>
                    <div className="text-xs text-white/40">listeners</div>
                  </div>
                )}
                {(spotify?.followers ?? 0) > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{formatCompact(spotify!.followers!)}</div>
                    <div className="text-xs text-white/40">followers</div>
                  </div>
                )}
                {(lastfm?.playcount ?? 0) > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{formatCompact(lastfm!.playcount!)}</div>
                    <div className="text-xs text-white/40">scrobbles</div>
                  </div>
                )}
                {(spotify?.popularity ?? 0) > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{spotify!.popularity}%</div>
                    <div className="text-xs text-white/40">popularity</div>
                  </div>
                )}
              </div>
            </div>

            {/* Formation info */}
            {(mb?.begin_date || mb?.country) && (
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-3">Formation</h3>
                <div className="flex gap-6 text-sm text-white/50">
                  {mb?.begin_date && <div><span className="text-white/70 font-medium">{mb.begin_date}</span> formed</div>}
                  {mb?.country && <div><span className="text-white/70 font-medium">{mb.country}</span></div>}
                  {mb?.area && <div><span className="text-white/70 font-medium">{mb.area}</span></div>}
                </div>
              </div>
            )}

            {/* Library stats */}
            <div className="flex gap-6 text-sm text-white/40">
              <div><span className="text-white/70 font-medium">{data.albums.length}</span> albums in library</div>
              <div><span className="text-white/70 font-medium">{formatNumber(totalTracks)}</span> tracks</div>
              <div><span className="text-white/70 font-medium">{formatSize(totalSize)}</span></div>
            </div>

            {/* External links (full list) */}
            {externalLinks.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-3">Links</h3>
                <div className="flex gap-2 flex-wrap">
                  {externalLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors ${link.color}`}
                    >
                      <Globe size={12} /> {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
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

// ── Sub-components ──

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-white/40 mb-1">{icon}<span className="text-[11px]">{label}</span></div>
      <div className="text-sm font-semibold text-white/80">{value}</div>
    </div>
  );
}

function PopularityBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-[40px] h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: "linear-gradient(90deg, #6b7280, #22c55e)",
          }}
        />
      </div>
      <span className="text-[10px] text-white/30">{value}</span>
    </div>
  );
}

// Global enrichment cache — survives navigation between artist pages
interface NetworkNodeMeta { similar: string[]; popularity: number; listeners?: number; playcount?: number; genres?: string[] }
const _networkEnrichCache = new Map<string, NetworkNodeMeta>();

function NetworkNodeThumb({ name }: { name: string }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="w-9 h-9 rounded-md bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-primary/60">{name.charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      src={`/api/artist/${encPath(name)}/photo`}
      alt=""
      className="w-9 h-9 rounded-md object-cover bg-secondary flex-shrink-0"
      onError={() => setErr(true)}
    />
  );
}

function ArtistNetworkGraph({ centerArtist, similar, onNodeClick, onDownload }: { centerArtist: string; similar: string[]; onNodeClick: (name: string) => void; onDownload?: (name: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(500);
  const [nodes, setNodes] = useState<{ id: string; depth: number }[]>([]);
  const [links, setLinks] = useState<{ source: string; target: string }[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [focusNode, setFocusNode] = useState(centerArtist);
  const [nodeMeta, setNodeMeta] = useState<Map<string, { popularity: number; listeners?: number; playcount?: number; genres?: string[] }>>(new Map());
  function calcPop(d: { lastfm?: { listeners?: number }; spotify?: { popularity?: number } }): number {
    const listeners = d?.lastfm?.listeners ?? 0;
    const spotPop = d?.spotify?.popularity ?? 0;
    const pop = spotPop || (listeners > 0 ? Math.min(100, Math.round((Math.log(listeners) - Math.log(5000)) / (Math.log(50000000) - Math.log(5000)) * 100)) : 0);
    return Math.max(0, Math.min(100, pop));
  }

  async function prefetchNode(name: string): Promise<NetworkNodeMeta | null> {
    if (_networkEnrichCache.has(name)) {
      const cached = _networkEnrichCache.get(name)!;
      setNodeMeta((prev) => {
        const n = new Map(prev);
        if (!n.has(name)) n.set(name, { popularity: cached.popularity, listeners: cached.listeners, playcount: cached.playcount, genres: cached.genres });
        return n;
      });
      return cached;
    }
    try {
      const d = await api<{ lastfm?: { similar?: { name: string }[]; listeners?: number; playcount?: number; tags?: string[] }; spotify?: { popularity?: number; genres?: string[] } }>(`/api/artist/${encPath(name)}/enrichment`);
      const genres = d?.lastfm?.tags?.slice(0, 3) ?? d?.spotify?.genres?.slice(0, 3) ?? [];
      const result: NetworkNodeMeta = {
        similar: d?.lastfm?.similar?.map((s) => s.name) ?? [],
        popularity: calcPop(d),
        listeners: d?.lastfm?.listeners,
        playcount: d?.lastfm?.playcount,
        genres,
      };
      _networkEnrichCache.set(name, result);
      setNodeMeta((prev) => new Map(prev).set(name, { popularity: result.popularity, listeners: result.listeners, playcount: result.playcount, genres: result.genres }));
      return result;
    } catch { return null; }
  }

  // Initialize with center artist + level 1, prefetch level 2 in background
  useEffect(() => {
    const nodeMap = new Map<string, number>();
    nodeMap.set(centerArtist, 0);
    const newLinks: { source: string; target: string }[] = [];
    for (const s of similar) {
      if (!nodeMap.has(s)) nodeMap.set(s, 1);
      newLinks.push({ source: centerArtist, target: s });
    }
    setNodes(Array.from(nodeMap.entries()).map(([id, depth]) => ({ id, depth })));
    setLinks(newLinks);
    setExpandedNodes(new Set([centerArtist]));
    setFocusNode(centerArtist);

    // Prefetch all level-1 nodes with stagger to avoid API rate limits
    const allNames = [centerArtist, ...similar];
    let cancelled = false;
    (async () => {
      for (const n of allNames) {
        if (cancelled) break;
        await prefetchNode(n);
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    return () => { cancelled = true; };
  }, [centerArtist, similar]);

  useEffect(() => {
    if (!containerRef.current) return;
    setWidth(containerRef.current.clientWidth || 500);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.floor(e.contentRect.width) || 500);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  async function expandNode(name: string) {
    if (expandedNodes.has(name)) {
      onNodeClick(name);
      return;
    }

    // Use cache (prefetched in background), falls back to fetch
    const cached = await prefetchNode(name);
    if (!cached || cached.similar.length === 0) {
      onNodeClick(name);
      return;
    }

    const nodeSimilar = cached.similar;
    setNodes((prev) => {
      const existing = new Set(prev.map((n) => n.id));
      const toAdd = nodeSimilar.filter((s) => !existing.has(s)).slice(0, 8);
      return [...prev, ...toAdd.map((id) => ({ id, depth: 2 }))];
    });
    setLinks((prev) => {
      const existingSet = new Set(prev.map((l) => `${l.source}->${l.target}`));
      const newLinks = nodeSimilar
        .slice(0, 8)
        .map((s) => ({ source: name, target: s }))
        .filter((l) => !existingSet.has(`${l.source}->${l.target}`));
      return [...prev, ...newLinks];
    });
    setExpandedNodes((prev) => new Set([...prev, name]));
    setFocusNode(name);

    // Prefetch next level in background (staggered)
    (async () => {
      for (const s of nodeSimilar.slice(0, 8)) {
        if (_networkEnrichCache.has(s)) continue;
        await prefetchNode(s);
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height: 400 }}>
      <Network
        data={{ nodes, links }}
        width={width}
        height={400}
        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
        repulsivity={Math.max(60, width / 5)}
        iterations={130}
        linkDistance={50}
        centeringStrength={0.3}
        nodeSize={(n: { id: string }) => {
          const meta = nodeMeta.get(n.id);
          const pop = meta?.popularity ?? 0;
          // Base size from popularity: 8px (0%) to 24px (100%)
          const popSize = 8 + (pop / 100) * 16;
          if (n.id === centerArtist) return Math.max(22, popSize);
          if (n.id === focusNode) return Math.max(16, popSize);
          return Math.max(8, popSize);
        }}
        nodeColor={(n: { id: string }) => {
          if (n.id === centerArtist) return "#06b6d4";
          if (n.id === focusNode && focusNode !== centerArtist) return "#8b5cf6";
          if (expandedNodes.has(n.id)) return "#22c55e";
          return "#6b7280";
        }}
        nodeBorderWidth={2}
        nodeBorderColor={(n: { id: string }) => {
          if (n.id === centerArtist) return "#0891b2";
          if (expandedNodes.has(n.id)) return "#16a34a";
          return "#4b5563";
        }}
        linkThickness={1}
        linkColor="#6b7280"
        linkBlendMode="normal"
        animate={true}
        motionConfig="gentle"
        onClick={(node) => expandNode(String(node.id))}
        nodeTooltip={({ node }) => {
          const meta = nodeMeta.get(String(node.id));
          const nodeName = String(node.id);
          return (
            <div className="bg-card text-foreground text-xs rounded-lg border border-border shadow-lg min-w-[200px] overflow-hidden">
              <div className="flex items-start gap-2.5 p-2.5">
                <NetworkNodeThumb name={nodeName} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{nodeName}</div>
                  {meta?.genres && meta.genres.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {meta.genres.map((g) => (
                        <span key={g} className="text-[9px] px-1.5 py-0 rounded-full bg-white/8 text-muted-foreground border border-white/10">
                          {g.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                  {meta && meta.popularity > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${meta.popularity}%`, background: "linear-gradient(90deg, #6b7280, #22c55e)" }} />
                      </div>
                      <span className="text-[9px] text-muted-foreground">{meta.popularity}%</span>
                    </div>
                  )}
                  {(meta?.listeners || meta?.playcount) && (
                    <div className="flex gap-3 mt-1 text-[9px] text-muted-foreground">
                      {meta.listeners ? <span>{formatCompact(meta.listeners)} listeners</span> : null}
                      {meta.playcount ? <span>{formatCompact(meta.playcount)} scrobbles</span> : null}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between px-2.5 pb-2 -mt-0.5">
                <span className="text-[9px] text-muted-foreground/60">
                  {node.id === centerArtist ? "Current artist" : expandedNodes.has(String(node.id)) ? "Click to visit" : "Click to expand"}
                </span>
                {node.id !== centerArtist && (
                  <button
                    className="text-[9px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      onDownload?.(nodeName);
                    }}
                  >
                    <Download size={9} /> Tidal
                  </button>
                )}
              </div>
            </div>
          );
        }}
      />
      <div className="text-[10px] text-muted-foreground mt-1 text-center">
        Click a node to expand its connections. Click again to visit the artist page.
      </div>
    </div>
  );
}

function SimilarArtistCard({ name, genres, popularity }: { name: string; genres?: string[]; popularity?: number }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  return (
    <Link
      to={`/artist/${encPath(name)}`}
      className="group text-center"
    >
      <div className="w-full aspect-square rounded-xl overflow-hidden mb-2 ring-1 ring-white/5 group-hover:ring-cyan-500/30 transition-all duration-300 group-hover:scale-[1.03]">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(name)}/photo?random=true`}
            alt={name}
            loading="lazy"
            className={`w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : null}
        {(imgError || !imgLoaded) && (
          <div className={`w-full h-full bg-gradient-to-br from-cyan-600/20 to-cyan-900/10 flex items-center justify-center ${imgLoaded && !imgError ? "hidden" : ""}`}>
            <span className="text-3xl font-bold text-white/20">{letter}</span>
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-white/70 group-hover:text-white truncate transition-colors">{name}</div>
      {genres && genres.length > 0 && (
        <div className="text-[10px] text-white/30 truncate mt-0.5">{genres.slice(0, 2).join(", ")}</div>
      )}
      {popularity != null && popularity > 0 && (
        <div className="flex justify-center mt-1">
          <PopularityBar value={popularity} />
        </div>
      )}
    </Link>
  );
}
