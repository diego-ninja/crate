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
  hidden?: boolean;
}

const PROPS: Prop[] = [
  {
    icon: Database,
    title: "A catalog you can trust",
    body: "Crate indexes your music folder, keeps stable identities for artists, albums, and tracks, and keeps file writes in the worker instead of the API. Boring boundaries, but useful ones.",
    className: "md:col-span-2",
  },
  {
    icon: Sparkles,
    title: "Context when it helps",
    body: "Crate can pull information from MusicBrainz, Last.fm, Discogs, Fanart.tv, Setlist.fm, Ticketmaster, and a few fallbacks. Bios, images, discographies, genres, and shows are meant to support the library, not bury it.",
  },
  {
    icon: Activity,
    title: "Audio analysis",
    body: "Crate can analyze BPM, key, loudness, mood, and similarity. That data feeds radio, playlists, EQ hints, and browsing, but it stays explainable and local to your instance.",
  },
  {
    icon: SlidersHorizontal,
    title: "A player for your collection",
    body: "The Listen app is there for day-to-day use: gapless playback, crossfade, EQ, lyrics, offline albums, and mobile installs. Nothing revolutionary, just the things a music app should have.",
    className: "md:col-span-2",
  },
  {
    icon: Radio,
    title: "Radio from your own files",
    body: "Start from an artist, genre, or track and Crate builds a queue from the music you already have. Feedback nudges future choices without turning the whole thing into a mystery algorithm.",
  },
  {
    icon: Route,
    title: "Music Paths",
    body: "An experiment in moving between sounds: choose a start and an end, then let Crate find tracks that bridge the space between them.",
    hidden: true,
  },
  {
    icon: Calendar,
    title: "Shows and setlists",
    body: "Crate can keep an eye on concerts for artists in your library, and connect those shows back to the music you already listen to.",
  },
  {
    icon: Mic2,
    title: "Optional local AI",
    body: "If you run an LLM, Crate can use it for things like genre notes, EQ suggestions, or playlist ideas. It is optional, and it is meant to help you edit, not pretend to know your taste better than you do.",
  },
  {
    icon: Users,
    title: "Small social features",
    body: "Follow people on your instance, share playlists, and listen together. It is designed for friends and small communities, not growth loops.",
  },
  {
    icon: Terminal,
    title: "Readable enough to change",
    body: "FastAPI, PostgreSQL, Redis, React, Go, and Rust where they make sense. The goal is a codebase that can be understood and self-hosted without ceremony.",
  },
];

export function ValueProps() {
  return (
    <section id="features" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          What it can do
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Useful pieces around a music library.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate does a few jobs at once: it catalogs files, adds context, serves audio,
          runs background work, and gives you separate surfaces for listening and
          library care. You can use the parts that matter to you.
        </p>
      </div>

      <div className="grid gap-x-8 gap-y-10 md:grid-cols-3">
        {PROPS.filter(({ hidden }) => !hidden).map(({ icon: Icon, title, body, className }) => (
          <article
            key={title}
            className={`group border-t border-white/10 pt-6 ${className ?? ""}`}
          >
            <div className="mb-4 text-cyan-300">
              <Icon size={18} />
            </div>
            <h3 className="mb-2 text-lg font-semibold tracking-tight text-white">{title}</h3>
            <p className="text-[14.5px] leading-[1.65] text-white/60">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
