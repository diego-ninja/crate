import { useMemo, useState, useEffect, useCallback } from "react";
import { ArrowRight, Tag, Sparkles, Sun, Volume2, Activity, Radio, Music, Play, SkipForward } from "lucide-react";

// ── Adaptive EQ mock ────────────────────────────────────────────────

const EQ_BANDS = ["32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"];

const EQ_CURVES: Record<string, { label: string; gains: number[]; chip: string }> = {
  black_metal: {
    label: "Black Metal",
    gains: [-1, 3, 4, 1, -3, -2, 3, 6, 6, 4],
    chip: "Inherited from metal taxonomy",
  },
  shoegaze: {
    label: "Shoegaze",
    gains: [1, 2, 3, 3, 4, 3, 2, 1, 0, 0],
    chip: "Direct preset",
  },
  doom: {
    label: "Doom / Sludge",
    gains: [6, 6, 5, 3, 0, -2, -3, -3, -2, -1],
    chip: "Direct preset",
  },
  hip_hop: {
    label: "Hip-Hop",
    gains: [6, 5, 3, 1, 0, 1, 2, 3, 3, 2],
    chip: "Direct preset",
  },
};

function EqMock() {
  const [presetKey, setPresetKey] = useState<keyof typeof EQ_CURVES>("black_metal");
  const preset = EQ_CURVES[presetKey]!;
  const range = 24;
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/40 p-5 shadow-[0_30px_80px_-40px_rgba(6,182,212,0.4)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
          <Sparkles size={11} />
          Equalizer
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-medium text-cyan-200">
          <Tag size={10} />
          {preset.chip}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(EQ_CURVES) as Array<keyof typeof EQ_CURVES>).map((key) => {
          const active = key === presetKey;
          return (
            <button
              key={key}
              onClick={() => setPresetKey(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                active
                  ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-200"
                  : "border-white/10 bg-white/5 text-white/60 hover:border-white/20 hover:text-white"
              }`}
            >
              {EQ_CURVES[key]!.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-10 gap-1.5 rounded-xl border border-white/10 bg-black/40 p-3">
        {preset.gains.map((g, i) => {
          const pct = ((g + 12) / range) * 100;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <span className="font-mono text-[9px] tabular-nums text-white/50">
                {g > 0 ? `+${g}` : g}
              </span>
              <div className="relative h-24 w-full">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
                <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full bg-white/[0.06]" />
                <div
                  className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)] transition-all duration-500"
                  style={{ top: `calc(${100 - pct}% - 6px)` }}
                />
              </div>
              <span className="font-mono text-[9px] text-white/45">{EQ_BANDS[i] ?? ""}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[9px] uppercase tracking-[0.14em] text-white/35">Track</span>
        <FeatureChip icon={Sun} label="97% bright" active />
        <FeatureChip icon={Volume2} label="-8.4 LUFS" active />
        <FeatureChip icon={Activity} label="9.8 dB DR" />
      </div>
    </div>
  );
}

function FeatureChip({
  icon: Icon,
  label,
  active,
}: {
  icon: typeof Sun;
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
        active
          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"
          : "border-white/10 bg-white/[0.03] text-white/55"
      }`}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}

// ── Taxonomy mock ──────────────────────────────────────────────────

function TaxonomyMock() {
  const nodes = useMemo(
    () => [
      { slug: "metal", name: "metal", gains: true, depth: 0, top: true },
      { slug: "thrash-metal", name: "thrash metal", gains: true, depth: 1 },
      { slug: "crossover-thrash", name: "crossover thrash", gains: false, depth: 1 },
      { slug: "black-metal", name: "black metal", gains: true, depth: 1, highlight: true },
      { slug: "death-metal", name: "death metal", gains: true, depth: 1 },
      { slug: "doom-metal", name: "doom metal", gains: true, depth: 1 },
      { slug: "sludge-metal", name: "sludge metal", gains: true, depth: 1 },
      { slug: "grindcore", name: "grindcore", gains: true, depth: 1 },
    ],
    [],
  );

  return (
    <div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
        <Tag size={11} />
        Genre taxonomy
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-white/55">
        Every canonical node can own an EQ preset. Nodes without one
        inherit from their parent via BFS — so new subgenres work on
        day one, and tuning happens in one place.
      </p>
      <div className="space-y-1">
        {nodes.map((n) => (
          <div
            key={n.slug}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition ${
              n.highlight
                ? "border-cyan-400/40 bg-cyan-400/10"
                : "border-white/6 bg-white/[0.02]"
            }`}
            style={{ marginLeft: n.depth * 16 }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                n.gains ? "bg-cyan-400" : "bg-white/25"
              }`}
            />
            <span
              className={`flex-1 font-medium ${
                n.highlight ? "text-cyan-100" : n.top ? "text-white" : "text-white/75"
              }`}
            >
              {n.name}
            </span>
            <span
              className={`text-[11px] ${
                n.gains ? "text-cyan-300/80" : "text-white/35"
              }`}
            >
              {n.gains ? "preset" : "inherits"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Radio constellation mock ──────────────────────────────────────

const RADIO_TRACKS = [
  { name: "Dark Horse", artist: "Converge", similarity: 0.94, angle: 0 },
  { name: "Aimless Arrow", artist: "Converge", similarity: 0.91, angle: 45 },
  { name: "Concubine", artist: "Converge", similarity: 0.88, angle: 90 },
  { name: "Province", artist: "Touche Amore", similarity: 0.82, angle: 135 },
  { name: "New Bermuda", artist: "Deafheaven", similarity: 0.79, angle: 180 },
  { name: "Sunbather", artist: "Deafheaven", similarity: 0.76, angle: 225 },
  { name: "Mariana", artist: "Birds In Row", similarity: 0.73, angle: 270 },
  { name: "I Don't Dance", artist: "Birds In Row", similarity: 0.71, angle: 315 },
];

function RadioMock() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [pulse, setPulse] = useState(false);

  const advance = useCallback(() => {
    setPulse(true);
    setTimeout(() => setPulse(false), 300);
    setActiveIndex((prev) => (prev + 1) % RADIO_TRACKS.length);
  }, []);

  useEffect(() => {
    const interval = setInterval(advance, 3000);
    return () => clearInterval(interval);
  }, [advance]);

  return (
    <div className="rounded-[24px] border border-white/10 bg-black/40 p-5 shadow-[0_30px_80px_-40px_rgba(6,182,212,0.4)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
          <Radio size={11} />
          Bliss Radio
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-medium text-cyan-200">
          <Activity size={10} />
          Song DNA similarity
        </span>
      </div>

      {/* Constellation */}
      <div className="relative mx-auto mb-4 h-[220px] w-[220px] sm:h-[260px] sm:w-[260px]">
        {/* Rings */}
        <div className="absolute inset-[15%] rounded-full border border-white/[0.04]" />
        <div className="absolute inset-[30%] rounded-full border border-white/[0.06]" />
        <div className="absolute inset-[45%] rounded-full border border-white/[0.04]" />

        {/* Center seed */}
        <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform duration-300 ${pulse ? "scale-125" : "scale-100"}`}>
          <div className="h-5 w-5 rounded-full bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.7)]" />
        </div>

        {/* Orbiting tracks */}
        {RADIO_TRACKS.map((track, i) => {
          const isActive = i === activeIndex;
          const distance = 35 + (1 - track.similarity) * 180;
          const angleRad = (track.angle * Math.PI) / 180;
          const x = Math.cos(angleRad) * distance;
          const y = Math.sin(angleRad) * distance;

          return (
            <div
              key={track.name}
              className="absolute left-1/2 top-1/2 transition-all duration-500"
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              }}
            >
              {/* Connection line */}
              <svg
                className="pointer-events-none absolute left-1/2 top-1/2 -z-10"
                width={Math.abs(x) + 20}
                height={Math.abs(y) + 20}
                style={{
                  transform: `translate(${x > 0 ? "-100%" : "0"}, ${y > 0 ? "-100%" : "0"})`,
                }}
              >
                <line
                  x1={x > 0 ? "100%" : "0"}
                  y1={y > 0 ? "100%" : "0"}
                  x2={x > 0 ? "0" : "100%"}
                  y2={y > 0 ? "0" : "100%"}
                  stroke={isActive ? "rgba(6,182,212,0.3)" : "rgba(255,255,255,0.06)"}
                  strokeWidth={isActive ? 1.5 : 0.5}
                />
              </svg>
              <div
                className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
                  isActive
                    ? "scale-150 bg-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.6)]"
                    : "bg-white/30"
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* Current track info */}
      <div className="rounded-xl border border-white/8 bg-black/30 p-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">
              {RADIO_TRACKS[activeIndex]!.name}
            </div>
            <div className="text-[11px] text-white/50">{RADIO_TRACKS[activeIndex]!.artist}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 font-mono text-[10px] tabular-nums text-cyan-200">
              {Math.round(RADIO_TRACKS[activeIndex]!.similarity * 100)}%
            </span>
            <button
              onClick={advance}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-300 transition hover:bg-cyan-400/25"
            >
              <SkipForward size={14} className="fill-current" />
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 text-[11px] leading-relaxed text-white/40">
        Seed any track. Bliss similarity vectors find what sounds
        alike — not what shares a tag. The queue regenerates as you skip.
      </div>
    </div>
  );
}

// ── Player mock ───────────────────────────────────────────────────

const LYRICS_LINES = [
  { time: 0, text: "Eagles become vultures" },
  { time: 4, text: "In the shadow of the gallows" },
  { time: 8, text: "Dark horse running" },
  { time: 12, text: "Through the fields of broken glass" },
  { time: 16, text: "We were never the same" },
  { time: 20, text: "After the fall" },
];

function PlayerMock() {
  const [currentLine, setCurrentLine] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const lineInterval = setInterval(() => {
      setCurrentLine((prev) => (prev + 1) % LYRICS_LINES.length);
    }, 2800);
    const progressInterval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 0 : prev + 0.3));
    }, 50);
    return () => {
      clearInterval(lineInterval);
      clearInterval(progressInterval);
    };
  }, []);

  return (
    <div className="rounded-[24px] border border-white/10 bg-black/40 p-5">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
        <Music size={11} />
        Listen app
      </div>

      {/* Mini player */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3">
        <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-gradient-to-br from-cyan-800/60 to-slate-900 shadow-lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">Dark Horse</div>
          <div className="text-[11px] text-white/50">Converge</div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 w-full rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-cyan-400 transition-[width] duration-100"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400 text-black shadow-[0_0_16px_rgba(6,182,212,0.5)]">
          <Play size={16} className="ml-0.5 fill-current" />
        </button>
      </div>

      {/* Synced lyrics */}
      <div className="rounded-xl border border-white/8 bg-black/20 p-3">
        <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/30">
          Synced lyrics
        </div>
        <div className="space-y-1.5">
          {LYRICS_LINES.map((line, i) => (
            <div
              key={i}
              className={`rounded-md px-2 py-1 text-[13px] transition-all duration-500 ${
                i === currentLine
                  ? "bg-cyan-400/10 font-semibold text-cyan-100"
                  : i < currentLine
                    ? "text-white/25"
                    : "text-white/50"
              }`}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-white/40">
        Gapless transitions, equal-power crossfade, synced lyrics with
        seek-by-line, and a WebGL visualiser driven by the real audio analyser.
        Offline mirror lets you download albums for playback without a network.
      </p>
    </div>
  );
}

// ── Section ────────────────────────────────────────────────────────

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
      <span>{children}</span>
    </li>
  );
}

export function FeatureShowcase() {
  return (
    <section className="relative mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28">
      <div className="mb-16 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          How it feels
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Smart defaults. Honest controls. No black boxes.
        </h2>
      </div>

      {/* Adaptive EQ feature */}
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,580px)]">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            An equalizer that reads the track.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Adaptive mode reads per-track brightness, loudness, dynamic range, and
            energy, and applies a "nudge, don't sculpt" heuristic — small corrections
            that respect what the mastering engineer did. Genre mode picks a preset from
            the track's canonical genre node, inheriting from parents when the specific
            subgenre doesn't own one.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>10 bands, peaking filters, ±12 dB range, per-band ramps so
              changes never click.</Bullet>
            <Bullet>20+ built-in presets tuned by genre — black metal, doom, shoegaze,
              post-rock, hip-hop, and so on.</Bullet>
            <Bullet>AI-generated presets — point your local LLM at a genre node and get
              a curve with written reasoning.</Bullet>
          </ul>
        </div>
        <EqMock />
      </div>

      {/* Taxonomy feature */}
      <div className="mt-28 grid items-center gap-10 lg:grid-cols-[minmax(0,580px)_minmax(0,1fr)]">
        <TaxonomyMock />
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A genre graph, not a dropdown.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Raw Last.fm tags get normalised into a curated taxonomy with parents,
            children, related links, aliases, and MusicBrainz references. The EQ
            presets attach to that graph, so maintenance happens in one place and
            new subgenres inherit sensible defaults the day they show up in your
            library.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>60+ canonical nodes seeded — rock, metal, punk, electronic,
              hip-hop, jazz, classical, ambient, and everything under them.</Bullet>
            <Bullet>Admin UI to edit preset gains per node, or drop back to
              inheritance with one click.</Bullet>
            <Bullet>LLM-assisted enrichment fills in descriptions and infers
              taxonomy relationships for unmapped tags.</Bullet>
          </ul>
          <a
            href="https://docs.cratemusic.app/technical/audio-analysis-similarity-and-discovery"
            className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
          >
            Read the audio analysis deep dive
            <ArrowRight size={14} />
          </a>
        </div>
      </div>

      {/* Radio & discovery */}
      <div className="mt-28 grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,580px)]">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Radio that learns what you want to hear.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Seed any artist, genre, or track and Crate builds an infinite queue
            using four signals: bliss acoustic similarity, Last.fm artist connections,
            shared band members (MusicBrainz), and genre overlap. Then shape it —
            like or dislike tracks and the radio adapts in real time. Discovery Radio auto-seeds from your follows and listening history.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>Hybrid scoring: 40% acoustic DNA, 35% artist affinity (including
              shared band members), 25% genre overlap.</Bullet>
            <Bullet>Pandora-style shaping — thumbs up shifts the sound toward what you
              liked, thumbs down creates exclusion zones.</Bullet>
            <Bullet>Feedback persists across sessions — your preferences carry over to
              future radios with temporal decay.</Bullet>
          </ul>
        </div>
        <RadioMock />
      </div>

      {/* Player & listening experience */}
      <div className="mt-28 grid items-center gap-10 lg:grid-cols-[minmax(0,580px)_minmax(0,1fr)]">
        <PlayerMock />
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A listening app, not a database viewer.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            The listen app is a real music player designed for the phone.
            Gapless playback, crossfade, synced lyrics, a WebGL visualiser,
            and offline support — built as a PWA and packaged for Android
            via Capacitor. The admin app handles library management, enrichment,
            and curation.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>Gapless transitions with equal-power crossfade — no silence
              between tracks.</Bullet>
            <Bullet>Synced lyrics (LRC) with seek-by-line — tap a line to jump
              to that moment.</Bullet>
            <Bullet>Offline mirror — download albums for playback without a
              network connection.</Bullet>
            <Bullet>Shows & events — see upcoming concerts for your artists,
              mark attendance, play probable setlists.</Bullet>
          </ul>
        </div>
      </div>
    </section>
  );
}
