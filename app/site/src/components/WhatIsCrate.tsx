import { Database, Headphones, Server, Settings2 } from "lucide-react";

export function WhatIsCrate() {
  return (
    <section id="what-is-crate" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          What is Crate?
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          A home for the music you already own.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate runs on a server you control. Point it at a music folder and it helps
          you browse, clean up, understand, and listen to that collection from the web
          or your phone.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <PartCard
          icon={Database}
          label="Catalog"
          title="Your files stay the source of truth."
          body="Crate scans a music folder, reads tags and artwork, stores a searchable catalog, and keeps stable identities for artists, albums, and tracks."
        />
        <PartCard
          icon={Settings2}
          label="Worker"
          title="Slow work happens in the background."
          body="Enrichment, lyrics, audio analysis, fingerprints, cache generation, imports, and repairs run as tasks instead of blocking the listening app."
        />
        <PartCard
          icon={Headphones}
          label="Listen"
          title="Playback is a separate app."
          body="The Listen app talks to your Crate server and focuses on day-to-day playback, search, albums, artists, playlists, and personal listening state."
        />
      </div>

      <div className="mt-14 grid gap-8 border-t border-white/10 pt-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <Server size={13} />
            How it is shaped
          </div>
          <h3 className="text-2xl font-semibold tracking-tight text-white">
            Admin and Listen do different jobs.
          </h3>
        </div>
        <div className="space-y-4 text-[15px] leading-7 text-white/58">
          <p>
            Admin is for looking after the library: imports, repairs, metadata,
            analysis, health, users, and background work. It is intentionally more
            operational.
          </p>
          <p>
            Listen is for playing music. It should feel quieter and more direct, because
            nobody wants to think about worker queues when they are just choosing an album.
          </p>
          <p>
            Underneath that, Crate uses a database, Redis, background workers, and a few
            native helpers. It is more demanding than a tiny music server because it is
            doing more than serving files, and that tradeoff is part of the project.
          </p>
        </div>
      </div>
    </section>
  );
}

function PartCard({
  icon: Icon,
  label,
  title,
  body,
}: {
  icon: typeof Database;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="group border-t border-white/10 pt-6">
      <div className="mb-4 text-cyan-300">
        <Icon size={18} />
      </div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300/70">
        {label}
      </div>
      <h3 className="mb-2 text-lg font-semibold tracking-tight text-white">{title}</h3>
      <p className="text-[14.5px] leading-[1.65] text-white/60">{body}</p>
    </div>
  );
}
