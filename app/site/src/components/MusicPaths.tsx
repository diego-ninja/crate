import { useCallback, useEffect, useState } from "react";
import { ArrowRight, MapPin, Play, Plus, Route } from "lucide-react";

// ── Data ──────────────────────────────────────────────────────────

interface PathNode {
  track: string;
  artist: string;
  genre: string;
  similarity: number; // 0-1 progress along the path
  energy: number;     // visual: node pulse intensity
}

const DEMO_PATHS: Record<string, { origin: string; destination: string; nodes: PathNode[] }> = {
  "nyhc-crank": {
    origin: "NY Hardcore",
    destination: "Crank Wave",
    nodes: [
      { track: "Don't Forget to Breathe", artist: "Madball", genre: "nyhc", similarity: 0, energy: 0.92 },
      { track: "Gomorrah", artist: "Trapped Under Ice", genre: "hardcore", similarity: 0.12, energy: 0.88 },
      { track: "Modern Life Is War", artist: "Defeater", genre: "melodic hc", similarity: 0.25, energy: 0.82 },
      { track: "No Spiritual Surrender", artist: "Inside Out", genre: "post-hardcore", similarity: 0.35, energy: 0.75 },
      { track: "Apes of God", artist: "Refused", genre: "post-hardcore", similarity: 0.48, energy: 0.80 },
      { track: "No Save Point", artist: "Run The Jewels", genre: "alt hip-hop", similarity: 0.58, energy: 0.78 },
      { track: "Crawl", artist: "Squid", genre: "post-punk", similarity: 0.70, energy: 0.74 },
      { track: "Narrator", artist: "Squid", genre: "post-punk", similarity: 0.78, energy: 0.70 },
      { track: "Nylon", artist: "Lynks", genre: "crank wave", similarity: 0.88, energy: 0.85 },
      { track: "Opus", artist: "Scowl", genre: "crank wave", similarity: 1, energy: 0.90 },
    ],
  },
  "ambient-metal": {
    origin: "Ambient",
    destination: "Black Metal",
    nodes: [
      { track: "An Ending", artist: "Brian Eno", genre: "ambient", similarity: 0, energy: 0.15 },
      { track: "Stars of the Lid", artist: "Stars of the Lid", genre: "drone", similarity: 0.12, energy: 0.18 },
      { track: "Dungtitled", artist: "Sigur Ros", genre: "post-rock", similarity: 0.25, energy: 0.30 },
      { track: "Storm", artist: "GY!BE", genre: "post-rock", similarity: 0.38, energy: 0.45 },
      { track: "Infinite Granite", artist: "Deafheaven", genre: "shoegaze", similarity: 0.48, energy: 0.55 },
      { track: "Sunbather", artist: "Deafheaven", genre: "blackgaze", similarity: 0.58, energy: 0.70 },
      { track: "New Bermuda", artist: "Deafheaven", genre: "blackgaze", similarity: 0.70, energy: 0.78 },
      { track: "Exercices Spirituels", artist: "Blut Aus Nord", genre: "atmo black", similarity: 0.82, energy: 0.72 },
      { track: "Bergtatt", artist: "Ulver", genre: "black metal", similarity: 0.90, energy: 0.80 },
      { track: "Transilvanian Hunger", artist: "Darkthrone", genre: "black metal", similarity: 1, energy: 0.88 },
    ],
  },
  "jazz-electronic": {
    origin: "Jazz",
    destination: "Electronic",
    nodes: [
      { track: "So What", artist: "Miles Davis", genre: "jazz", similarity: 0, energy: 0.40 },
      { track: "Maiden Voyage", artist: "Herbie Hancock", genre: "jazz", similarity: 0.12, energy: 0.42 },
      { track: "Chameleon", artist: "Herbie Hancock", genre: "jazz-funk", similarity: 0.25, energy: 0.55 },
      { track: "Lingus", artist: "Snarky Puppy", genre: "fusion", similarity: 0.38, energy: 0.65 },
      { track: "Glimmer", artist: "Bicep", genre: "breakbeat", similarity: 0.50, energy: 0.72 },
      { track: "Opus", artist: "Eric Prydz", genre: "progressive house", similarity: 0.60, energy: 0.78 },
      { track: "Windowlicker", artist: "Aphex Twin", genre: "idm", similarity: 0.72, energy: 0.68 },
      { track: "Xtal", artist: "Aphex Twin", genre: "ambient techno", similarity: 0.82, energy: 0.55 },
      { track: "Teardrops", artist: "Burial", genre: "dubstep", similarity: 0.90, energy: 0.50 },
      { track: "Archangel", artist: "Burial", genre: "electronic", similarity: 1, energy: 0.48 },
    ],
  },
};

const PATH_KEYS = Object.keys(DEMO_PATHS) as Array<keyof typeof DEMO_PATHS>;

// ── Component ─────────────────────────────────────────────────────

export function MusicPaths() {
  const [activePathKey, setActivePathKey] = useState<keyof typeof DEMO_PATHS>("nyhc-crank");
  const [activeStep, setActiveStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  // Sub-step progress: 0 = just arrived at activeStep, 1 = about to arrive at next
  const [subProgress, setSubProgress] = useState(0);
  const path = DEMO_PATHS[activePathKey]!;
  const nodeCount = path.nodes.length;

  // Animate sub-progress from 0→1 between steps
  useEffect(() => {
    if (!playing) return;
    setSubProgress(0);
    // Small delay before starting the travel animation
    const startTimer = setTimeout(() => setSubProgress(1), 80);
    const advanceTimer = setTimeout(() => {
      setActiveStep((prev) => (prev + 1) % nodeCount);
    }, 2200);
    return () => {
      clearTimeout(startTimer);
      clearTimeout(advanceTimer);
    };
  }, [activeStep, playing, nodeCount]);

  // Reset step when switching paths
  useEffect(() => {
    setActiveStep(0);
    setSubProgress(0);
  }, [activePathKey]);

  return (
    <section className="relative mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,620px)]">
        {/* Text */}
        <div>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Coming soon
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Music Paths — a GPS for your taste.
          </h2>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Pick a starting point and a destination — a genre, an artist, a track —
            and Crate traces a listening route through the acoustic space between them.
            Each step is a track that naturally bridges the gap, using bliss similarity
            vectors to find songs that sound like they belong in the transition.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <li className="flex gap-3">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
              <span>Add waypoints to steer the journey — "go through doom metal
                on the way to post-rock."</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
              <span>20-float bliss vectors interpolate across the acoustic space,
                not genre labels. The transitions sound natural.</span>
            </li>
            <li className="flex gap-3">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
              <span>Save paths as playlists, share them, or let them regenerate
                with fresh tracks every time.</span>
            </li>
          </ul>
          <a
            href="https://docs.cratemusic.app"
            className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
          >
            Read more about audio similarity
            <ArrowRight size={14} />
          </a>
        </div>

        {/* Interactive mock */}
        <div className="rounded-[24px] border border-white/10 bg-black/40 p-5 shadow-[0_30px_80px_-40px_rgba(6,182,212,0.4)]">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
              <Route size={11} />
              Music Path
            </div>
            <button
              onClick={() => setPlaying(!playing)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
                playing
                  ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                  : "border-white/10 bg-white/5 text-white/60 hover:border-white/20"
              }`}
            >
              {playing ? "Playing" : "Paused"}
            </button>
          </div>

          {/* Path selector pills */}
          <div className="mb-5 flex flex-wrap gap-1.5">
            {PATH_KEYS.map((key) => {
              const p = DEMO_PATHS[key]!;
              const active = key === activePathKey;
              return (
                <button
                  key={key}
                  onClick={() => setActivePathKey(key)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    active
                      ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                      : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {p.origin} → {p.destination}
                </button>
              );
            })}
          </div>

          {/* Origin / Destination labels */}
          <div className="mb-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em]">
            <span className="flex items-center gap-1.5 text-cyan-300">
              <MapPin size={10} />
              {path.origin}
            </span>
            <span className="flex items-center gap-1.5 text-cyan-300">
              {path.destination}
              <MapPin size={10} />
            </span>
          </div>

          {/* Path visualization — horizontal route with traveling dot */}
          <div className="relative mb-4 px-3 py-6">
            {/* Base track line */}
            <div className="absolute left-6 right-6 top-1/2 h-px -translate-y-1/2 bg-white/8" />

            {/* Trail — glowing line behind the traveler */}
            <div
              className="absolute left-6 top-1/2 h-[2px] -translate-y-1/2 rounded-full transition-[width] duration-[1800ms] ease-in-out"
              style={{
                width: `calc(${((activeStep + subProgress * (activeStep < nodeCount - 1 ? 1 : 0)) / (nodeCount - 1)) * 100}% * (100% - 48px) / 100%)`,
                background: "linear-gradient(90deg, rgba(6,182,212,0.1), rgba(6,182,212,0.5))",
                boxShadow: "0 0 8px rgba(6,182,212,0.3)",
              }}
            />

            {/* Static node markers */}
            <div className="relative flex items-center justify-between">
              {path.nodes.map((node, i) => {
                const isPast = i < activeStep;
                const isActive = i === activeStep;
                const showGenre = i === 0 || i === path.nodes.length - 1 || (i > 0 && node.genre !== path.nodes[i - 1]!.genre);

                return (
                  <button
                    key={i}
                    onClick={() => { setActiveStep(i); setSubProgress(0); }}
                    className="group relative flex h-4 w-4 flex-shrink-0 items-center justify-center"
                    title={`${node.track} — ${node.artist}`}
                  >
                    <div
                      className={`rounded-full transition-all duration-300 ${
                        isPast
                          ? "h-2 w-2 bg-cyan-400/70"
                          : isActive
                            ? "h-2 w-2 bg-cyan-400/70"
                            : "h-1.5 w-1.5 bg-white/20 group-hover:bg-white/40"
                      }`}
                    />
                    {showGenre && (
                      <span className={`pointer-events-none absolute top-full mt-1.5 whitespace-nowrap text-[8px] transition-colors duration-300 ${
                        isActive || isPast ? "text-cyan-300/60" : "text-white/20"
                      }`}>
                        {node.genre}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Traveling dot — moves smoothly between nodes */}
            <div
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 transition-[left] duration-[1800ms] ease-in-out"
              style={{
                left: `calc(24px + ${((activeStep + subProgress * (activeStep < nodeCount - 1 ? 1 : 0)) / (nodeCount - 1)) * 100}% * (100% - 48px) / 100%)`,
              }}
            >
              {/* Outer glow */}
              <div className="absolute -inset-3 rounded-full bg-cyan-400/20 blur-md" />
              {/* Core dot */}
              <div className="relative h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.8)]" />
            </div>
          </div>

          {/* Current track card */}
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 transition-all duration-300">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-cyan-400/15">
                <Play size={16} className="ml-0.5 fill-cyan-300 text-cyan-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-white">
                  {path.nodes[activeStep]!.track}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-white/50">
                  <span>{path.nodes[activeStep]!.artist}</span>
                  <span className="text-white/15">·</span>
                  <span className="text-cyan-300/70">{path.nodes[activeStep]!.genre}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-mono text-[10px] tabular-nums text-cyan-200">
                  Step {activeStep + 1}/{path.nodes.length}
                </span>
                {/* Energy bar */}
                <div className="flex h-1 w-12 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-cyan-400/60 transition-all duration-500"
                    style={{ width: `${path.nodes[activeStep]!.energy * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Waypoint hint */}
          <div className="mt-3 flex items-center gap-2 text-[11px] text-white/35">
            <Plus size={10} className="text-cyan-400/50" />
            <span>Add waypoints to steer the route through specific genres or artists</span>
          </div>
        </div>
      </div>
    </section>
  );
}
