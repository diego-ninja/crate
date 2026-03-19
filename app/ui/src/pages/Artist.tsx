import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { AlbumCard } from "@/components/album/AlbumCard";
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
import { encPath, formatSize, formatNumber, formatCompact, formatDuration } from "@/lib/utils";
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
} from "lucide-react";

interface ArtistData {
  name: string;
  albums: {
    name: string;
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

interface ArtistInfo {
  bio: string;
  tags: string[];
  similar: { name: string }[];
  listeners: number;
  playcount: number;
  image_url: string;
  url: string;
}

interface NavidromeArtistLink {
  id: string;
  name: string;
  navidrome_url: string;
}

interface TopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track: number;
}

export function Artist() {
  const { name } = useParams<{ name: string }>();
  const decodedName = name ? decodeURIComponent(name) : "";
  const { data, loading } = useApi<ArtistData>(
    name ? `/api/artist/${encPath(decodedName)}` : null,
  );
  const player = usePlayer();

  const [sort, setSort] = useState("name");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [bgLoaded, setBgLoaded] = useState(false);
  const [info, setInfo] = useState<ArtistInfo | null>(null);
  const [, setInfoLoaded] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [navidromeLink, setNavidromeLink] = useState<NavidromeArtistLink | null>(null);
  const [topTracks, setTopTracks] = useState<TopTrack[]>([]);
  const [activeSection, setActiveSection] = useState<"discography" | "top-tracks" | "similar" | "about">("discography");
  const [showMissing, setShowMissing] = useState(true);
  const [missingAlbums, setMissingAlbums] = useState<{ title: string; first_release_date: string; type: string }[]>([]);
  const [missingLoaded, setMissingLoaded] = useState(false);
  const bgRef = useRef<HTMLImageElement>(null);

  // Fetch Last.fm info
  useEffect(() => {
    if (!data?.name) return;
    let cancelled = false;
    api<ArtistInfo>(`/api/artist/${encPath(data.name)}/info`)
      .then((d) => { if (!cancelled) { setInfo(d); setInfoLoaded(true); } })
      .catch(() => { setInfoLoaded(true); });
    return () => { cancelled = true; };
  }, [data?.name]);

  // Fetch Navidrome link
  useEffect(() => {
    if (!data?.name) return;
    let cancelled = false;
    api<NavidromeArtistLink>(`/api/navidrome/artist/${encPath(data.name)}/link`)
      .then((d) => { if (!cancelled) setNavidromeLink(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data?.name]);

  // Fetch top tracks
  useEffect(() => {
    if (!data?.name) return;
    let cancelled = false;
    api<TopTrack[]>(`/api/navidrome/artist/${encPath(data.name)}/top-tracks?count=10`)
      .then((d) => { if (!cancelled && Array.isArray(d)) setTopTracks(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data?.name]);

  // Fetch missing albums (lazy, on discography tab activation)
  useEffect(() => {
    if (!data?.name || activeSection !== "discography" || missingLoaded) return;
    let cancelled = false;
    api<{ missing: { title: string; first_release_date: string; type: string }[] }>(`/api/missing/${encPath(data.name)}`)
      .then((d) => { if (!cancelled) { setMissingAlbums(d.missing ?? []); setMissingLoaded(true); } })
      .catch(() => { if (!cancelled) setMissingLoaded(true); });
    return () => { cancelled = true; };
  }, [data?.name, activeSection, missingLoaded]);

  if (loading) {
    return (
      <div className="-mx-8 -mt-8">
        <div className="h-[360px] bg-card animate-pulse" />
        <div className="px-8 pt-6">
          <div className="flex gap-2 mb-6">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-9 w-28" />)}
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

  const allTags = (() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const t of [...(data.genres ?? []), ...(info?.tags ?? [])]) {
      const lower = t.toLowerCase();
      if (!seen.has(lower)) { seen.add(lower); result.push(t); }
    }
    return result;
  })();

  const bioText = info?.bio ?? "";

  function playTopTrack(_track: TopTrack, index: number) {
    const tracks: PlayerTrack[] = topTracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      albumCover: undefined,
    }));
    player.playAll(tracks, index);
  }

  const sections = [
    { key: "discography" as const, label: "Discography", count: data.albums.length },
    { key: "top-tracks" as const, label: "Top Tracks", count: topTracks.length },
    { key: "similar" as const, label: "Similar Artists", count: info?.similar?.length ?? 0 },
    { key: "about" as const, label: "About", count: bioText ? 1 : 0 },
  ];

  return (
    <div className="-mx-8 -mt-8">
      {/* ═══ HERO BANNER ═══ */}
      <div className="relative h-[360px] md:h-[400px] overflow-hidden">
        {/* Background image */}
        <img
          ref={bgRef}
          src={`/api/artist/${encPath(data.name)}/background`}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover object-top transition-opacity duration-1000 ${bgLoaded ? "opacity-40" : "opacity-0"}`}
          onLoad={() => setBgLoaded(true)}
          onError={() => {}}
        />

        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]/40" />

        {/* Noise texture overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        }} />

        {/* Content */}
        <div className="absolute inset-0 flex items-end px-8 pb-8">
          <div className="flex items-end gap-6 max-w-4xl w-full">
            {/* Artist photo */}
            <div className="w-[160px] h-[160px] md:w-[180px] md:h-[180px] rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-white/10 shadow-2xl shadow-black/50">
              {!photoError ? (
                <img
                  src={`/api/artist/${encPath(data.name)}/photo`}
                  alt={data.name}
                  className={`w-full h-full object-cover transition-opacity duration-500 ${photoLoaded ? "opacity-100" : "opacity-0"}`}
                  onLoad={() => setPhotoLoaded(true)}
                  onError={() => setPhotoError(true)}
                />
              ) : null}
              {(photoError || !photoLoaded) && (
                <div className={`w-full h-full bg-gradient-to-br from-violet-600/40 to-violet-900/20 flex items-center justify-center ${photoLoaded && !photoError ? "hidden" : ""}`}>
                  <span className="text-5xl font-black text-white/40">{letter}</span>
                </div>
              )}
            </div>

            {/* Artist info */}
            <div className="flex-1 min-w-0 pb-1">
              {/* Breadcrumb */}
              <div className="text-xs text-white/40 mb-2">
                <Link to="/browse" className="hover:text-white/70 transition-colors">Browse</Link>
                <span className="mx-1.5">/</span>
                <span className="text-white/60">{data.name}</span>
              </div>

              {/* Name */}
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-white leading-none mb-3 truncate">
                {data.name}
              </h1>

              {/* Stats row */}
              <div className="flex items-center gap-4 text-sm text-white/50 mb-3 flex-wrap">
                <span className="flex items-center gap-1.5"><Disc3 size={14} />{data.albums.length} albums</span>
                <span className="flex items-center gap-1.5"><Music size={14} />{formatNumber(totalTracks)} tracks</span>
                <span className="flex items-center gap-1.5"><HardDrive size={14} />{formatSize(totalSize)}</span>
                {info && info.listeners > 0 && (
                  <span className="flex items-center gap-1.5"><Headphones size={14} />{formatCompact(info.listeners)} listeners</span>
                )}
              </div>

              {/* Tags */}
              {allTags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-4">
                  {allTags.slice(0, 8).map((g) => (
                    <span key={g} className="text-[11px] px-2 py-0.5 rounded-full bg-white/8 text-white/60 border border-white/10">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                {topTracks.length > 0 && (
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-500 text-white"
                    onClick={() => topTracks[0] && playTopTrack(topTracks[0], 0)}
                  >
                    <Play size={14} className="mr-1 fill-current" /> Play Top Tracks
                  </Button>
                )}
                {navidromeLink?.navidrome_url && (
                  <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                    <a href={navidromeLink.navidrome_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={14} className="mr-1" /> Navidrome
                    </a>
                  </Button>
                )}
                {info?.url && (
                  <Button size="sm" variant="outline" className="border-white/20 text-white/70 hover:text-white hover:bg-white/10" asChild>
                    <a href={info.url} target="_blank" rel="noopener noreferrer">
                      Last.fm
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ SECTION TABS ═══ */}
      <div className="px-8 border-b border-border sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-sm z-10">
        <div className="flex gap-1 -mb-px">
          {sections.filter(s => s.count > 0).map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveSection(s.key)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                activeSection === s.key
                  ? "border-violet-500 text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {s.label}
              {s.key !== "about" && (
                <span className="ml-1.5 text-xs text-white/30">{s.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="px-8 pt-6 pb-12">

        {/* Discography */}
        {activeSection === "discography" && (
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

        {/* Top Tracks */}
        {activeSection === "top-tracks" && (
          <div className="max-w-3xl">
            {topTracks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No top tracks available</div>
            ) : (
              <div className="space-y-1">
                {topTracks.map((track, i) => {
                  const isCurrent = player.queue[player.currentIndex]?.id === track.id;
                  const isCurrentPlaying = isCurrent && player.isPlaying;
                  return (
                    <button
                      key={track.id}
                      onClick={() => {
                        if (isCurrentPlaying) player.pause();
                        else if (isCurrent) player.resume();
                        else playTopTrack(track, i);
                      }}
                      className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-white/5 transition-colors group text-left ${isCurrent ? "bg-white/[0.03]" : ""}`}
                    >
                      {isCurrent ? (
                        isCurrentPlaying ? (
                          <Pause size={14} className="text-violet-400 w-6 text-right fill-current" />
                        ) : (
                          <Play size={14} className="text-violet-400 w-6 text-right fill-current" />
                        )
                      ) : (
                        <>
                          <span className="w-6 text-right text-sm text-white/30 group-hover:hidden">{i + 1}</span>
                          <Play size={14} className="text-violet-400 hidden group-hover:block w-6 text-right fill-current" />
                        </>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium truncate ${isCurrent ? "text-violet-400" : "text-white/90"}`}>{track.title}</div>
                        <div className="text-xs text-white/40 truncate">{track.album}</div>
                      </div>
                      <span className="text-xs text-white/30">{formatDuration(track.duration)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Similar Artists */}
        {activeSection === "similar" && info?.similar && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
            {info.similar.map((s) => (
              <SimilarArtistCard key={s.name} name={s.name} />
            ))}
          </div>
        )}

        {/* About */}
        {activeSection === "about" && (
          <div className="max-w-2xl space-y-6">
            {bioText && (
              <div>
                <p className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
                  {bioExpanded ? bioText : bioText.slice(0, 300)}
                  {!bioExpanded && bioText.length > 300 && "..."}
                </p>
                {bioText.length > 300 && (
                  <button
                    onClick={() => setBioExpanded(!bioExpanded)}
                    className="text-xs text-violet-400 hover:text-violet-300 mt-2 flex items-center gap-1"
                  >
                    {bioExpanded ? <><ChevronUp size={12} /> Less</> : <><ChevronDown size={12} /> More</>}
                  </button>
                )}
              </div>
            )}

            {info && (info.listeners > 0 || info.playcount > 0) && (
              <div className="flex gap-6">
                {info.listeners > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{formatCompact(info.listeners)}</div>
                    <div className="text-xs text-white/40">listeners</div>
                  </div>
                )}
                {info.playcount > 0 && (
                  <div>
                    <div className="text-2xl font-bold text-white/90">{formatCompact(info.playcount)}</div>
                    <div className="text-xs text-white/40">scrobbles</div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-6 text-sm text-white/40">
              <div><span className="text-white/70 font-medium">{data.albums.length}</span> albums in library</div>
              <div><span className="text-white/70 font-medium">{formatNumber(totalTracks)}</span> tracks</div>
              <div><span className="text-white/70 font-medium">{formatSize(totalSize)}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SimilarArtistCard({ name }: { name: string }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const letter = name.charAt(0).toUpperCase();

  return (
    <Link
      to={`/artist/${encPath(name)}`}
      className="group text-center"
    >
      <div className="w-full aspect-square rounded-xl overflow-hidden mb-2 ring-1 ring-white/5 group-hover:ring-violet-500/30 transition-all duration-300 group-hover:scale-[1.03]">
        {!imgError ? (
          <img
            src={`/api/artist/${encPath(name)}/photo`}
            alt={name}
            loading="lazy"
            className={`w-full h-full object-cover transition-opacity duration-500 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        ) : null}
        {(imgError || !imgLoaded) && (
          <div className={`w-full h-full bg-gradient-to-br from-violet-600/20 to-violet-900/10 flex items-center justify-center ${imgLoaded && !imgError ? "hidden" : ""}`}>
            <span className="text-3xl font-bold text-white/20">{letter}</span>
          </div>
        )}
      </div>
      <div className="text-sm font-medium text-white/70 group-hover:text-white truncate transition-colors">{name}</div>
    </Link>
  );
}
