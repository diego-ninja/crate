import { ArrowRight } from "lucide-react";
import { AlbumGrid } from "./AlbumGrid";
import { GithubIcon } from "./GithubIcon";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <AlbumGrid />

      <div className="relative z-10 mx-auto max-w-[1400px] px-5 pt-20 pb-28 sm:px-8 sm:pt-28 sm:pb-40">
        {/* Logo — large, centered, with cyan glow */}
        <div className="fade-up fade-up-1 flex flex-col items-center text-center">
          <div className="relative mb-8">
            <div className="absolute -inset-8 rounded-full bg-cyan-400/15 blur-3xl" />
            <img
              src="/icons/logo.svg"
              alt="Crate"
              className="relative h-24 w-24 drop-shadow-[0_0_40px_rgba(6,182,212,0.5)] sm:h-32 sm:w-32 lg:h-40 lg:w-40"
            />
          </div>

          {/* Motto */}
          <h1 className="fade-up fade-up-2 text-[48px] font-semibold leading-[1] tracking-[-0.04em] text-white sm:text-[72px] lg:text-[96px]">
            Own your music.
          </h1>

          {/* Badge */}
          <div className="fade-up fade-up-2 mt-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
            Self-hosted — Open source — In beta
          </div>
        </div>

        {/* Description — centered below motto */}
        <p className="fade-up fade-up-3 mx-auto mt-8 max-w-2xl text-center text-base leading-7 text-white/60 sm:text-lg sm:leading-8">
          Crate is a self-hosted music platform that indexes your files, enriches
          them from eight+ sources, extracts audio DNA for discovery, and ships a
          listening app that finally feels like one — not like a database viewer.
        </p>

        {/* CTAs — centered */}
        <div className="fade-up fade-up-4 mt-9 flex flex-wrap items-center justify-center gap-3">
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
        <div className="fade-up fade-up-4 mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-white/35">
          <span>900+ artists indexed on the reference instance</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/15 sm:block" />
          <span>4 400 albums, 48 K tracks, 1.2 TB</span>
          <span className="hidden h-1 w-1 rounded-full bg-white/15 sm:block" />
          <span>Subsonic-compatible — works with Symfonium, DSub, Ultrasonic</span>
        </div>
      </div>
    </section>
  );
}
