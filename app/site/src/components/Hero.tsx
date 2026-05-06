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

        </div>

        <div className="fade-up fade-up-3 mt-9 mx-auto max-w-3xl text-center">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            The Crate Manifesto
          </div>
          <blockquote className="text-[24px] font-medium leading-[1.28] tracking-tight text-white/78 sm:text-[34px]">
            "In a system where artists earn $0.003 per stream while platforms
            collect billions, piracy is not theft. It's self-defense."
          </blockquote>
          <a
            href="/why"
            className="group mt-7 inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-3 text-sm font-semibold text-[#05161c] shadow-[0_0_24px_-6px_rgba(6,182,212,0.6)] transition hover:bg-cyan-300"
          >
            Read the manifesto
            <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <div className="fade-up fade-up-4 mx-auto mt-8 max-w-2xl text-center">
          <p className="text-base leading-7 text-white/58 sm:text-lg sm:leading-8">
            Crate is an open-source project for people who want to stop renting
            their listening life from platforms. Host it yourself, bring the files
            you care about, invite whoever you trust, and keep the music close.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://docs.cratemusic.app/technical/system-overview"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]"
            >
              Read the docs
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
          </div>
        </div>
      </div>
    </section>
  );
}
