import { ArrowRight } from "lucide-react";
import { AlbumGrid } from "./AlbumGrid";
import { GithubIcon } from "./GithubIcon";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <AlbumGrid />

      <div className="relative z-10 mx-auto max-w-[1400px] px-5 pt-20 pb-24 sm:px-8 sm:pt-28 sm:pb-32">
        {/* Logo + Crate + Motto — stacked, centered */}
        <div className="fade-up fade-up-1 flex flex-col items-center text-center">
          <div className="relative mb-4">
            <div className="absolute -inset-8 rounded-full bg-cyan-400/15 blur-3xl" />
            <img
              src="/icons/logo.svg"
              alt="Crate"
              className="relative h-20 w-20 drop-shadow-[0_0_40px_rgba(6,182,212,0.5)] sm:h-28 sm:w-28 lg:h-36 lg:w-36"
            />
          </div>

          {/* Crate wordmark — outlined in accent color */}
          <div
            className="fade-up fade-up-1 mb-2 text-[56px] font-black leading-none tracking-[-0.04em] text-transparent sm:text-[96px] lg:text-[140px]"
            style={{
              WebkitTextStroke: "1.5px rgba(6, 182, 212, 0.3)",
            }}
          >
            Crate
          </div>

          {/* Motto — overlaps slightly with the wordmark via negative margin */}
          <h1 className="fade-up fade-up-2 -mt-5 text-[40px] font-semibold leading-[1] tracking-[-0.04em] text-white sm:-mt-8 sm:text-[64px] lg:-mt-12 lg:text-[88px]">
            Own your music.
          </h1>

          {/* Badge */}
          <div className="fade-up fade-up-2 mt-5 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
            Self-hosted — Open source — In beta
          </div>
        </div>

        {/* Description */}
        <p className="fade-up fade-up-3 mx-auto mt-6 max-w-2xl text-center text-base leading-7 text-white/60 sm:text-lg sm:leading-8">
          Crate is a self-hosted music platform that indexes your files, enriches
          them from eight+ sources, extracts audio DNA for discovery, and ships a
          listening app that finally feels like one — not like a database viewer.
        </p>

        {/* CTAs */}
        <div className="fade-up fade-up-4 mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="https://docs.cratemusic.app/technical/system-overview"
            className="group inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#05161c] shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)] transition hover:bg-cyan-300"
          >
            Read the docs
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </a>
          <a
            href="https://github.com/diego-ninja/crate"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]"
          >
            <GithubIcon size={16} />
            See the source
          </a>
          <a
            href="#beta"
            className="ml-1 text-sm text-cyan-300/80 underline-offset-4 transition hover:text-cyan-200 hover:underline"
          >
            Join the beta
          </a>
        </div>

        {/* Proof strip */}
        <div className="fade-up fade-up-4 mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-white/35">
          <span>480+ artists on the reference instance</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/15 sm:block" />
          <span>5 100 albums, 77 K tracks</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/15 sm:block" />
          <span>Subsonic-compatible — works with Symfonium, DSub, Ultrasonic</span>
        </div>
      </div>
    </section>
  );
}
