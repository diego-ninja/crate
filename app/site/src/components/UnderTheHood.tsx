/**
 * Stack section. Lists each technology with a one-line reason why
 * Crate picked it, rather than the usual "row of logos" that conveys
 * nothing. Grouped into backend / data / frontend / audio so the
 * architecture reads at a glance.
 */

interface Entry {
  name: string;
  reason: string;
}

const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: "Backend",
    entries: [
      { name: "FastAPI", reason: "Fast, typed, async — the right Python API framework in 2026." },
      { name: "Dramatiq + Redis", reason: "Durable background jobs with DB-persisted status rows." },
      { name: "PostgreSQL 15", reason: "One store for library, users, tasks, cache fallback." },
      { name: "Open Subsonic", reason: "Third-party clients just work — Symfonium, DSub, Ultrasonic." },
    ],
  },
  {
    title: "Audio & analysis",
    entries: [
      { name: "Essentia", reason: "Native DSP — LUFS, key, mood, danceability." },
      { name: "PANNs CNN14", reason: "AudioSet-trained semantic classifier, mapped to listening concepts." },
      { name: "Bliss-rs", reason: "Rust CLI that produces a 20-float song-DNA vector per track." },
      { name: "librosa (fallback)", reason: "ARM-safe pure-Python backend with the same output schema." },
    ],
  },
  {
    title: "Frontends",
    entries: [
      { name: "React 19 + Vite", reason: "Modern, fast, boring — and easy for contributors to jump into." },
      { name: "Tailwind CSS 4", reason: "@theme inline lets both admin and listen share a visual language." },
      { name: "Gapless-5 (vendored)", reason: "Real gapless + crossfade + our own patches for EQ and offline resilience." },
      { name: "Capacitor", reason: "Same Listen codebase ships to iOS and Android when needed." },
    ],
  },
  {
    title: "Acquisition",
    entries: [
      { name: "Tidal (via tiddl)", reason: "High-quality downloads straight into the canonical library." },
      { name: "Soulseek (slskd)", reason: "REST-wrapped peer search with quality filtering and retry." },
      { name: "MusicBrainz", reason: "Discography, MBIDs, and the backbone of the completeness graph." },
      { name: "Last.fm + Discogs", reason: "Bios, tags, popularity, and cross-referenced artist data." },
    ],
  },
];

export function UnderTheHood() {
  return (
    <section id="stack" className="relative border-y border-white/6 bg-gradient-to-b from-white/[0.015] via-transparent to-white/[0.015]">
      <div className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-28">
        <div className="mb-12 max-w-2xl">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Under the hood
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
            Boring, obvious technology — put together carefully.
          </h2>
          <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
            Nothing here is exotic. That's the point: Crate picks the dull, stable
            building block every time so contributors can ship on day one and
            self-hosters can reason about what's running on their machine.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="rounded-[18px] border border-white/8 bg-white/[0.02] p-5">
              <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                {group.title}
              </div>
              <div className="space-y-4">
                {group.entries.map((entry) => (
                  <div key={entry.name}>
                    <div className="text-sm font-semibold text-white">{entry.name}</div>
                    <p className="mt-1 text-[13px] leading-[1.55] text-white/55">{entry.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
