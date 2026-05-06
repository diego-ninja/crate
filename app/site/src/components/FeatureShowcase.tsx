import { useMemo, useState, useEffect, useCallback } from "react";
import { ArrowRight, Tag, Sparkles, Sun, Volume2, Activity, Radio, SkipForward } from "lucide-react";

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
        Genre tags are messy. Crate keeps a small taxonomy so related styles can
        share defaults, and you can fix things in one place instead of editing
        every album by hand.
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
        Start from a track and let Crate look for nearby sounds in your own library.
        Skips and likes nudge what comes next.
      </div>
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
          A closer look
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Some ideas inside Crate.
        </h2>
      </div>

      {/* Adaptive EQ feature */}
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,580px)]">
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            EQ can use what Crate knows about a track.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Adaptive mode looks at simple audio features like brightness, loudness,
            dynamic range, and energy. It makes small changes, not a dramatic remix.
            Genre mode can use a preset from the track's genre, with inheritance for
            nearby subgenres.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>10 bands with smooth ramps so changes do not click.</Bullet>
            <Bullet>Genre presets for styles where a small tonal nudge is useful.</Bullet>
            <Bullet>Optional LLM-assisted preset drafts when you want a starting point.</Bullet>
          </ul>
        </div>
        <EqMock />
      </div>

      {/* Taxonomy feature */}
      <div className="mt-28 grid items-center gap-10 lg:grid-cols-[minmax(0,580px)_minmax(0,1fr)]">
        <TaxonomyMock />
        <div>
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Genres are treated as a map, not a flat list.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Raw tags from files and external sources are noisy. Crate tries to group
            them into a smaller taxonomy with parents, aliases, and related styles,
            so browsing and EQ presets have something steadier to lean on.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>Seeded genre families for common styles and substyles.</Bullet>
            <Bullet>Admin tools to rename, merge, map, or let a tag inherit context.</Bullet>
            <Bullet>Optional assistance for unmapped tags, always editable afterwards.</Bullet>
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
            Radio built from your own library.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            Part of the inspiration is old Pandora: that feeling of starting with a
            song and letting a station slowly find its shape. Crate tries to bring a
            little of that back, but using the music you already have. It combines
            acoustic similarity, artist links, shared members, and genre overlap, then
            lets likes and skips gently steer the next choices.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>Uses audio similarity, artist relationships, and genre overlap.</Bullet>
            <Bullet>Likes and dislikes adjust the queue without hiding why tracks appeared.</Bullet>
            <Bullet>Feedback can carry across sessions, but it stays on your instance.</Bullet>
          </ul>
        </div>
        <RadioMock />
      </div>

      {/* Listening experience */}
      <div className="mt-28 max-w-2xl">
          <h3 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            A player for the library you keep.
          </h3>
          <p className="mt-4 text-[15px] leading-7 text-white/60">
            The Listen app is the everyday player. It has gapless playback, crossfade,
            lyrics, offline support, and mobile installs. The admin app stays separate,
            because managing a library and listening to one are different moods.
          </p>
          <ul className="mt-6 space-y-3 text-[14.5px] text-white/75">
            <Bullet>Gapless playback and crossfade for albums and queues.</Bullet>
            <Bullet>Synced lyrics when they are available.</Bullet>
            <Bullet>Offline albums for places where the network is not reliable.</Bullet>
            <Bullet>Shows and setlists connected back to the artists in your library.</Bullet>
          </ul>
      </div>
    </section>
  );
}
