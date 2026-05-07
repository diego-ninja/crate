import { useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { AlbumGrid } from "./AlbumGrid";
import { GithubIcon } from "./GithubIcon";

const INSTALL_COMMAND = "curl -fsSL https://cratemusic.app/install.sh | bash";

function InstallCommand() {
  const [copied, setCopied] = useState(false);

  async function copyInstallCommand() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(INSTALL_COMMAND);
      } else {
        const input = document.createElement("textarea");
        input.value = INSTALL_COMMAND;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto mt-9 w-full max-w-3xl overflow-hidden rounded-lg border border-white/10 bg-[#050608] text-left shadow-[0_22px_70px_-50px_rgba(6,182,212,0.65)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-[#0b0d10] px-3 py-2.5 sm:px-4">
        <div className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <button
          type="button"
          onClick={copyInstallCommand}
          className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-[12px] font-medium text-white/55 transition hover:border-white/18 hover:bg-white/[0.07] hover:text-white/85"
          aria-label={copied ? "Copied installer command" : "Copy installer command"}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span className="hidden sm:inline">{copied ? "copied" : "copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-6 text-[#d6f7ff] sm:px-5 sm:text-sm">
        <code>
          <span className="select-none text-[#5eead4]/70">$ </span>
          {INSTALL_COMMAND}
        </code>
      </pre>
    </div>
  );
}

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

          <InstallCommand />

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://docs.cratemusic.app/technical/system-overview"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-white/85 transition hover:border-white/25 hover:bg-white/[0.08]"
            >
              Read the docs
            </a>
            <a
              href="https://github.com/thecrateapp/crate"
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
