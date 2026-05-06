import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Download,
  Gauge,
  GitBranch,
  HeartPulse,
  Library,
  ListMusic,
  Monitor,
  Network,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Users,
  Waves,
} from "lucide-react";

type Surface = "listen" | "admin";

interface ScreenshotItem {
  id: string;
  title: string;
  kicker: string;
  description: string;
  src: string;
}

const LISTEN_SHOTS: ScreenshotItem[] = [
  {
    id: "home",
    title: "Personal Home",
    kicker: "Listen",
    description: "Recommended artists, recently played music, custom mixes, and new albums in one calm listening surface.",
    src: "/showcase/listen/home.webp",
  },
  {
    id: "player",
    title: "Fullscreen Player",
    kicker: "Playback",
    description: "Queue, playback quality, audio profile, visualizer controls, and now-playing context without leaving the music.",
    src: "/showcase/listen/player.webp",
  },
  {
    id: "album",
    title: "Album View",
    kicker: "Library",
    description: "A focused album page with quality badges, tags, actions, and an uncluttered track list.",
    src: "/showcase/listen/album.webp",
  },
  {
    id: "artist",
    title: "Artist Profile",
    kicker: "Library",
    description: "Artist pages bring together discography, context, and playback in a way that still feels fast to browse.",
    src: "/showcase/listen/artist.webp",
  },
  {
    id: "explore",
    title: "Explore",
    kicker: "Discovery",
    description: "Editorial playlists, generated routes, genres, decades, and audio-analysis moods for library-first discovery.",
    src: "/showcase/listen/explore.webp",
  },
  {
    id: "home-search",
    title: "Search Overlay",
    kicker: "Find",
    description: "Fast search over the local catalog, designed to feel native in the listening app.",
    src: "/showcase/listen/home-search.webp",
  },
  {
    id: "stats",
    title: "Listening Stats",
    kicker: "Activity",
    description: "Personal listening history and taste signals, separate from the admin surface.",
    src: "/showcase/listen/stats.webp",
  },
  {
    id: "upcoming",
    title: "Upcoming Releases",
    kicker: "Radar",
    description: "Release tracking for artists already in the library, surfaced where listeners can actually use it.",
    src: "/showcase/listen/upcoming.webp",
  },
  {
    id: "collection-albums",
    title: "Album Collection",
    kicker: "Collection",
    description: "Dense album browsing with enough cover art to feel musical and enough restraint to stay useful.",
    src: "/showcase/listen/collection-albums.webp",
  },
  {
    id: "collection-artists",
    title: "Artist Collection",
    kicker: "Collection",
    description: "Artist-first navigation for people who think about music as scenes, catalogs, and relationships.",
    src: "/showcase/listen/collection-artists.webp",
  },
];

const ADMIN_SHOTS: ScreenshotItem[] = [
  {
    id: "dashboard",
    title: "Operations Dashboard",
    kicker: "Admin",
    description: "The first-glance control room for health, pipeline state, recent failures, and worker pressure.",
    src: "/showcase/admin/dashboard.webp",
  },
  {
    id: "album-view",
    title: "Album Intelligence",
    kicker: "Catalog",
    description: "Album metadata, audio profile, quality, lyrics state, variants, and per-track operational actions.",
    src: "/showcase/admin/album-view.webp",
  },
  {
    id: "artist-view",
    title: "Artist Overview",
    kicker: "Catalog",
    description: "Artist identity, popularity, genres, upcoming shows, enrichment, metadata, and export controls.",
    src: "/showcase/admin/artist-view.webp",
  },
  {
    id: "artist-discography",
    title: "Artist Discography",
    kicker: "Catalog",
    description: "A full artist catalog view for owned albums, missing releases, and acquisition opportunities.",
    src: "/showcase/admin/artist-discography.webp",
  },
  {
    id: "artist-network",
    title: "Artist Network",
    kicker: "Graph",
    description: "Similarity and relationship exploration for moving through scenes instead of flat lists.",
    src: "/showcase/admin/artist-network.webp",
  },
  {
    id: "artist-stats",
    title: "Artist Stats",
    kicker: "Analytics",
    description: "Depth, popularity, catalog shape, audio analysis, and operational completeness at artist level.",
    src: "/showcase/admin/artist-stats.webp",
  },
  {
    id: "browse",
    title: "Library Browse",
    kicker: "Catalog",
    description: "High-density catalog navigation across artists, albums, formats, and library state.",
    src: "/showcase/admin/browse.webp",
  },
  {
    id: "discovery",
    title: "Discovery Console",
    kicker: "Curation",
    description: "Operational discovery tools for playlists, recommendations, and generated library surfaces.",
    src: "/showcase/admin/discovery.webp",
  },
  {
    id: "acquistion-tidal",
    title: "Tidal Acquisition",
    kicker: "Acquisition",
    description: "Search external catalogs, compare owned copies, and pull better versions into Crate.",
    src: "/showcase/admin/acquistion-tidal.webp",
  },
  {
    id: "library-health",
    title: "Library Health",
    kicker: "Repair",
    description: "Find broken layouts, missing metadata, duplicate issues, and risky catalog drift.",
    src: "/showcase/admin/library-health.webp",
  },
  {
    id: "analysis",
    title: "Analysis Pipeline",
    kicker: "Audio",
    description: "Visibility into analysis coverage, fingerprints, Bliss vectors, lyrics, and portable metadata.",
    src: "/showcase/admin/analysis.webp",
  },
  {
    id: "system-health",
    title: "System Health",
    kicker: "Runtime",
    description: "API latency, error rate, cache state, playback transcoding, worker slots, and resource pressure.",
    src: "/showcase/admin/system-health.webp",
  },
  {
    id: "system-metrics",
    title: "System Metrics",
    kicker: "Runtime",
    description: "Historical metrics and runtime signals for understanding why the system feels fast or slow.",
    src: "/showcase/admin/system-metrics.webp",
  },
  {
    id: "tasks",
    title: "Task Queue",
    kicker: "Workers",
    description: "Explicit and background work with queue visibility, progress, failures, and retry controls.",
    src: "/showcase/admin/tasks.webp",
  },
  {
    id: "stack",
    title: "Stack Services",
    kicker: "Infra",
    description: "A live map of containers, ports, health, and service state for the self-hosted stack.",
    src: "/showcase/admin/stack.webp",
  },
  {
    id: "collection-insigths",
    title: "Collection Insights",
    kicker: "Analytics",
    description: "Catalog-level rollups for depth, format, duration, popularity, and analysis completeness.",
    src: "/showcase/admin/collection-insigths.webp",
  },
  {
    id: "genres",
    title: "Genre Workspace",
    kicker: "Taxonomy",
    description: "Genre cleanup and taxonomy operations across the full library.",
    src: "/showcase/admin/genres.webp",
  },
  {
    id: "genre",
    title: "Genre Detail",
    kicker: "Taxonomy",
    description: "A single genre view with albums, artists, tracks, and local context.",
    src: "/showcase/admin/genre.webp",
  },
  {
    id: "genre-tree",
    title: "Genre Tree",
    kicker: "Taxonomy",
    description: "Hierarchical genre mapping for turning messy tags into useful navigation.",
    src: "/showcase/admin/genre-tree.webp",
  },
  {
    id: "genre-eq-preset",
    title: "Genre EQ Preset",
    kicker: "Audio",
    description: "Audio presets and genre-aware playback tuning generated from the library context.",
    src: "/showcase/admin/genre-eq-preset.webp",
  },
  {
    id: "new-releases",
    title: "New Releases",
    kicker: "Radar",
    description: "Upcoming and recent releases from artists Crate already knows you care about.",
    src: "/showcase/admin/new-releases.webp",
  },
  {
    id: "users",
    title: "Users",
    kicker: "Accounts",
    description: "Admin visibility into users, roles, sessions, and account state.",
    src: "/showcase/admin/users.webp",
  },
  {
    id: "settings",
    title: "Settings",
    kicker: "Config",
    description: "Instance-level settings for providers, acquisition, integrations, and runtime behavior.",
    src: "/showcase/admin/settings.webp",
  },
];

const SCREENSHOTS: Record<Surface, ScreenshotItem[]> = {
  listen: LISTEN_SHOTS,
  admin: ADMIN_SHOTS,
};

const SURFACE_COPY: Record<
  Surface,
  {
    label: string;
    description: string;
    icon: typeof Smartphone;
  }
> = {
  listen: {
    label: "Listen",
    description: "The music app your users actually touch.",
    icon: Smartphone,
  },
  admin: {
    label: "Admin",
    description: "The operator console behind the library.",
    icon: Monitor,
  },
};

const QUICK_JUMPS: Array<{ label: string; surface: Surface; index: number; icon: typeof Smartphone }> = [
  { label: "Home", surface: "listen", index: 0, icon: Library },
  { label: "Player", surface: "listen", index: 1, icon: Radio },
  { label: "Explore", surface: "listen", index: 4, icon: Waves },
  { label: "Stats", surface: "listen", index: 6, icon: BarChart3 },
  { label: "Dashboard", surface: "admin", index: 0, icon: Activity },
  { label: "Album intelligence", surface: "admin", index: 1, icon: Disc3 },
  { label: "Artist network", surface: "admin", index: 4, icon: Network },
  { label: "System health", surface: "admin", index: 11, icon: HeartPulse },
  { label: "Acquisition", surface: "admin", index: 8, icon: Download },
  { label: "Tasks", surface: "admin", index: 13, icon: ListMusic },
  { label: "Genres", surface: "admin", index: 16, icon: Tags },
  { label: "Settings", surface: "admin", index: 22, icon: Settings },
  { label: "Users", surface: "admin", index: 21, icon: Users },
  { label: "Metrics", surface: "admin", index: 12, icon: Gauge },
  { label: "Tree", surface: "admin", index: 18, icon: GitBranch },
  { label: "Search", surface: "listen", index: 5, icon: Search },
  { label: "Upcoming", surface: "listen", index: 7, icon: CalendarDays },
  { label: "EQ", surface: "admin", index: 19, icon: SlidersHorizontal },
];

function getWindowedShots(shots: ScreenshotItem[], index: number) {
  if (shots.length <= 5) return shots;
  const start = Math.min(Math.max(index - 2, 0), shots.length - 5);
  return shots.slice(start, start + 5);
}

export function Screenshots() {
  const [surface, setSurface] = useState<Surface>("listen");
  const [index, setIndex] = useState(0);
  const shots = SCREENSHOTS[surface];
  const current = shots[index] ?? shots[0]!;
  const visibleShots = getWindowedShots(shots, index);
  const SurfaceIcon = SURFACE_COPY[surface].icon;

  useEffect(() => {
    const next = shots[(index + 1) % shots.length];
    const prev = shots[(index - 1 + shots.length) % shots.length];
    [next, prev].forEach((shot) => {
      if (!shot) return;
      const image = new Image();
      image.src = shot.src;
    });
  }, [index, shots]);

  const showSurface = (nextSurface: Surface) => {
    setSurface(nextSurface);
    setIndex(0);
  };

  const prev = () => setIndex((i) => (i === 0 ? shots.length - 1 : i - 1));
  const next = () => setIndex((i) => (i === shots.length - 1 ? 0 : i + 1));

  const jumpTo = (nextSurface: Surface, nextIndex: number) => {
    setSurface(nextSurface);
    setIndex(nextIndex);
  };

  return (
    <section id="screenshots" className="relative mx-auto max-w-[1480px] scroll-mt-24 px-5 pb-36 pt-24 sm:px-8 sm:pb-40 sm:pt-32">
      <div className="mb-10 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Screenshots
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
            What it looks like right now.
          </h2>
          <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
            These are captures from the current Listen and Admin apps. They will change,
            but they give a fair sense of where Crate is today.
          </p>
        </div>

        <div className="grid gap-2 rounded-full border border-white/8 bg-white/[0.03] p-1 sm:inline-grid sm:grid-cols-2">
          {(Object.keys(SURFACE_COPY) as Surface[]).map((item) => {
            const Icon = SURFACE_COPY[item].icon;
            const active = item === surface;
            return (
              <button
                key={item}
                type="button"
                onClick={() => showSurface(item)}
                className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-cyan-400 text-[#041319] shadow-[0_0_20px_-8px_rgba(34,211,238,0.8)]"
                    : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
                }`}
              >
                <Icon size={16} />
                {SURFACE_COPY[item].label}
                <span className={active ? "text-[#041319]/60" : "text-white/30"}>
                  {SCREENSHOTS[item].length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
          <div className="relative flex min-h-[360px] items-center justify-center sm:min-h-[520px]">
            <img
              key={current.id}
              src={current.src}
              alt={`${current.title} screenshot in ${SURFACE_COPY[surface].label}`}
              className="block max-h-[860px] w-full object-contain object-center [filter:drop-shadow(0_26px_34px_rgba(6,182,212,0.14))]"
              fetchPriority={index === 0 && surface === "listen" ? "high" : "auto"}
            />

            <button
              onClick={prev}
              aria-label="Previous screenshot"
              className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white/70 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-black/75 hover:text-white"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={next}
              aria-label="Next screenshot"
              className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white/70 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-black/75 hover:text-white lg:right-4"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <aside className="p-1 lg:p-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">
              <SurfaceIcon size={14} />
              {SURFACE_COPY[surface].label}
            </div>
            <h3 className="mt-5 text-3xl font-semibold tracking-tight text-white">
              {current.title}
            </h3>
            <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              {current.kicker}
            </p>
            <p className="mt-4 text-sm leading-6 text-white/58">
              {current.description}
            </p>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between text-[12px] text-white/35">
                <span>{index + 1} of {shots.length}</span>
                <span>{SURFACE_COPY[surface].description}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-all duration-300"
                  style={{ width: `${((index + 1) / shots.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="mt-8 grid gap-2">
              {visibleShots.map((shot) => {
                const shotIndex = shots.findIndex((item) => item.id === shot.id);
                const active = shot.id === current.id;
                return (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => setIndex(shotIndex)}
                    className={`group grid grid-cols-[64px_1fr] items-center gap-3 rounded-md p-2 text-left transition ${
                      active
                        ? "bg-white/[0.08] text-white"
                        : "text-white/48 hover:bg-white/[0.04] hover:text-white/78"
                    }`}
                  >
                    <img
                      src={shot.src}
                      alt=""
                      loading="lazy"
                      className="h-10 w-16 rounded-sm object-cover opacity-80 transition group-hover:opacity-100"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{shot.title}</span>
                      <span className="block truncate text-[11px] uppercase tracking-[0.16em] text-white/35">
                        {shot.kicker}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {QUICK_JUMPS.map((item) => {
          const Icon = item.icon;
          const active = item.surface === surface && item.index === index;
          return (
            <button
              key={`${item.surface}-${item.label}`}
              type="button"
              onClick={() => jumpTo(item.surface, item.index)}
              className={`inline-flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-medium transition ${
                active
                  ? "border-cyan-300/40 bg-cyan-300/12 text-cyan-100"
                  : "border-white/8 bg-white/[0.025] text-white/46 hover:border-white/14 hover:bg-white/[0.045] hover:text-white/76"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
