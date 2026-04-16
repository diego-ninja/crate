import { useMemo, useState } from "react";
import { ArrowRight, Tag, Sparkles, Sun, Volume2, Activity } from "lucide-react";

/**
 * Two marquee features get their own visual mock-up: the adaptive
 * equalizer and the genre taxonomy editor. Both are the clearest
 * demonstration of Crate's "smart but explicit" design philosophy.
 */

// ── Adaptive EQ mock ────────────────────────────────────────────────

const EQ_BANDS = ["32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"];

// Preset curves to cycle through, matching what Listen ships with.
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
  const range = 24; // -12 to +12
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

      {/* Preset chips */}
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

      {/* Bands */}
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
                {/* Track */}
                <div className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 rounded-full bg-white/[0.06]" />
                {/* Thumb position follows the gain with a tweened transform */}
                <div
                  className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.6)] transition-all duration-500"
                  style={{
                    top: `calc(${100 - pct}% - 6px)`,
                  }}
                />
              </div>
              <span className="font-mono text-[9px] text-white/45">{EQ_BANDS[i] ?? ""}</span>
            </div>
          );
        })}
      </div>

      {/* Feature chips that would drive the adaptive mode */}
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

// ── Section ────────────────────────────────────────────────────────

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
            <Bullet>Shows you exactly where the gains come from — direct preset,
              inherited, or analysis-driven — so the curve is never mysterious.</Bullet>
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
            <Bullet>Parent-BFS resolution lets you tune <code className="rounded bg-white/5 px-1 py-0.5 text-[12px] text-cyan-200">metal</code>
              {" "}once and have every subgenre follow.</Bullet>
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
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
      <span>{children}</span>
    </li>
  );
}
