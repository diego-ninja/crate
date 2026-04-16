import { Database, Sparkles, Activity, SlidersHorizontal, Users, Terminal } from "lucide-react";

/**
 * Bento-ish grid of six core value propositions. Deliberately asymmetric
 * so the page doesn't read as "stock 3×2 feature grid"; the two lead
 * cards (library ownership and the listening app) get wider tiles.
 */

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
    body: "Crate indexes your /music directory into PostgreSQL, tracks its own canonical identity per artist, album, and file, and never writes to the filesystem from the public-facing API. Two containers with asymmetric mounts (read-only + read-write) keep the boundary honest.",
    className: "md:col-span-2",
  },
  {
    icon: Sparkles,
    title: "Enrichment from 8+ sources",
    body: "MusicBrainz, Last.fm, Discogs, Fanart.tv, Cover Art Archive, Setlist.fm, Spotify popularity, Deezer / iTunes fallbacks. Biographies, photos, discographies, similar artists, and a canonical genre taxonomy — merged and deduplicated server-side.",
  },
  {
    icon: Activity,
    title: "Audio intelligence",
    body: "Essentia plus PANNs extract BPM, key, loudness (LUFS), dynamic range, spectral complexity, mood, danceability, valence, acousticness. Bliss-rs computes a 20-float song-DNA vector for nearest-neighbour discovery. Used by radio, smart playlists, and the adaptive equalizer.",
  },
  {
    icon: SlidersHorizontal,
    title: "A listening app that plays",
    body: "Gapless transitions. Equal-power crossfade. A 10-band equalizer that can adapt to per-track features or follow the taxonomy-resolved preset for the genre. WebGL visualiser driven by the real audio analyser. PWA and Capacitor targets. Offline-resilient buffering — pull the wifi mid-track and the music keeps going.",
    className: "md:col-span-2",
  },
  {
    icon: Users,
    title: "Social, not surveillance",
    body: "Follow people, share collaborative playlists, listen together in jam rooms with room-scoped websockets. Affinity scores with reasons, not a black-box recommender. No anonymous telemetry leaves your server.",
  },
  {
    icon: Terminal,
    title: "Hackable by design",
    body: "FastAPI + Dramatiq + PostgreSQL + Redis on the backend. React 19 + Tailwind 4 + shadcn on the frontends. Open Subsonic API for third-party clients. Dramatiq tasks with live SSE status. One repo, one compose file, honest README.",
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
          Crate is the combination of an indexed library, a background pipeline for
          enrichment and analysis, a streaming backend with Subsonic compatibility,
          and two real frontends. Each piece is built to stand on its own.
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
            {/* Hover flourish — cyan beam sweeping across the top edge */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100" />
          </article>
        ))}
      </div>
    </section>
  );
}
