interface Entry {
  name: string;
  reason: string;
}

const GROUPS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: "Backend",
    entries: [
      { name: "FastAPI", reason: "The main Python API layer." },
      { name: "Dramatiq + Redis", reason: "Background jobs for slow work like scans, analysis, and enrichment." },
      { name: "PostgreSQL 15 + Alembic", reason: "The main database and migration system." },
      { name: "Redis 7", reason: "Cache, broker, streams, pub/sub, and short-lived metrics." },
      { name: "Open Subsonic", reason: "Compatibility with clients like Symfonium, DSub, and Ultrasonic." },
    ],
  },
  {
    title: "Audio & AI",
    entries: [
      { name: "Essentia", reason: "Audio features like loudness, key, rhythm, and spectral shape." },
      { name: "PANNs CNN14", reason: "Optional audio classification for higher-level listening hints." },
      { name: "Bliss-rs", reason: "Rust-based similarity vectors for radio and discovery." },
      { name: "Ollama / Gemini / litellm", reason: "Optional LLM support for drafts and suggestions." },
      { name: "librosa", reason: "Fallback analysis backend where native DSP is not available." },
    ],
  },
  {
    title: "Frontends",
    entries: [
      { name: "React 19 + Vite", reason: "Admin, Listen, and the marketing site." },
      { name: "@crate/ui", reason: "Shared UI pieces where both apps need the same thing." },
      { name: "Tailwind CSS 4", reason: "Styling and shared tokens." },
      { name: "Capacitor", reason: "Android and iOS wrappers for the Listen app." },
      { name: "Gapless-5", reason: "Playback engine with Crate-specific patches." },
    ],
  },
  {
    title: "Acquisition",
    entries: [
      { name: "Tidal", reason: "Acquisition support where account access is available." },
      { name: "Soulseek", reason: "Search and import support through slskd." },
      { name: "Ticketmaster", reason: "Upcoming shows for artists in the library." },
      { name: "MusicBrainz", reason: "Discography, MBIDs, and release matching." },
      { name: "Last.fm + Discogs", reason: "Tags, bios, popularity, and extra context." },
    ],
  },
];

export function UnderTheHood() {
  return (
    <section id="stack" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-28">
        <div className="mb-12 max-w-2xl">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Under the hood
          </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
            Familiar tools, kept visible.
          </h2>
          <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
            Crate is built from tools many self-hosters already know. The stack is not
            the point; being able to understand and operate it is.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="border-t border-white/10 pt-5">
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
    </section>
  );
}
