import {
  Activity,
  Calendar,
  Database,
  Mic2,
  Radio,
  Route,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";

interface Prop {
  icon: typeof Database;
  title: string;
  body: string;
  className?: string;
}

const PROPS: Prop[] = [
  {
    icon: Database,
    title: "Your library, end to end",
    body: "Crate indexes your /music directory into PostgreSQL, builds a canonical identity per artist, album, and file, and never writes to the filesystem from the API. Two containers with asymmetric mounts (read-only + read-write) keep the boundary honest.",
    className: "md:col-span-2",
  },
  {
    icon: Sparkles,
    title: "Enrichment from 8+ sources",
    body: "MusicBrainz, Last.fm, Discogs, Fanart.tv, Cover Art Archive, Setlist.fm, Ticketmaster, Spotify popularity, Deezer / iTunes fallbacks. Biographies, photos, discographies, similar artists, upcoming shows, and a canonical genre taxonomy — merged and deduplicated server-side.",
  },
  {
    icon: Activity,
    title: "Audio intelligence",
    body: "Essentia plus PANNs extract BPM, key, loudness (LUFS), dynamic range, spectral complexity, mood, danceability, valence, acousticness. Bliss-rs computes a 20-float song-DNA vector per track. Used by radio, smart playlists, and the adaptive equalizer.",
  },
  {
    icon: SlidersHorizontal,
    title: "A listening app that plays",
    body: "Gapless transitions. Equal-power crossfade. A 10-band EQ that adapts to per-track analysis or follows the genre taxonomy preset. Synced lyrics with seek-by-line. WebGL visualiser. PWA and Capacitor targets. Offline mirror — download albums for playback without a network.",
    className: "md:col-span-2",
  },
  {
    icon: Radio,
    title: "Shaped Radio",
    body: "Seed any artist, genre, or track and Crate builds an infinite radio using a hybrid algorithm: bliss acoustic similarity, Last.fm artist connections, shared band members, and genre overlap. Like or dislike tracks to steer the sound in real time — Pandora-style shaping with your own library. Discovery Radio auto-seeds from your likes and follows.",
  },
  {
    icon: Route,
    title: "Music Paths",
    body: "Pick an origin and destination — a genre, artist, or track — and Crate traces a listening route through the acoustic space between them. Add waypoints to steer the journey. Each step sounds like it belongs in the transition.",
  },
  {
    icon: Calendar,
    title: "Shows & events",
    body: "Ticketmaster integration surfaces upcoming shows for artists in your library. Mark attendance, see probable setlists from Setlist.fm, play the setlist before you go. Upcoming events feed across all followed artists.",
  },
  {
    icon: Mic2,
    title: "AI-assisted curation",
    body: "Local LLM integration (Ollama, Gemini, or any litellm provider) generates EQ presets per genre, enriches taxonomy descriptions, and powers intelligent playlist suggestions. Runs on your hardware, no data leaves your server.",
  },
  {
    icon: Users,
    title: "Social, not surveillance",
    body: "Follow people, share collaborative playlists, listen together in jam rooms with room-scoped websockets. OAuth sign-in. Affinity scores with reasons, not a black-box recommender. No anonymous telemetry leaves your server.",
  },
  {
    icon: Terminal,
    title: "Hackable by design",
    body: "FastAPI + Dramatiq + PostgreSQL + Redis backend. React 19 + Tailwind 4 + @crate/ui shared design system. Open Subsonic API for third-party clients. Real-time SSE for task progress and cache invalidation. One repo, one compose file.",
  },
];

export function ValueProps() {
  return (
    <section id="features" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          What it is
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          A full platform, not a file browser with a play button.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate combines an indexed library, a background pipeline for enrichment
          and analysis, a streaming backend with Subsonic compatibility, and two
          real frontends — an admin app for library management and a listening
          app built for the phone.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PROPS.map(({ icon: Icon, title, body, className }) => (
          <article
            key={title}
            className={`group relative overflow-hidden rounded-[22px] border border-white/8 bg-white/[0.025] p-6 transition hover:border-cyan-400/25 hover:bg-white/[0.04] ${className ?? ""}`}
          >
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
              <Icon size={18} />
            </div>
            <h3 className="mb-2 text-lg font-semibold tracking-tight text-white">{title}</h3>
            <p className="text-[14.5px] leading-[1.65] text-white/60">{body}</p>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100" />
          </article>
        ))}
      </div>
    </section>
  );
}
