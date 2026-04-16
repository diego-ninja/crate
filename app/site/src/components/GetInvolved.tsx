import { BookOpen, MessageCircle, ArrowRight } from "lucide-react";
import type { ComponentType } from "react";
import { GithubIcon } from "./GithubIcon";

/**
 * Three-way CTA: self-hosters, contributors, beta testers. Written as
 * a pitch per audience rather than one generic "Get started" because
 * each path looks different. Self-hosters want docker compose, contributors
 * want a clean repo, beta testers want to know what "beta" means.
 */

// Both lucide icons and our GithubIcon satisfy this shape; typing Path.icon
// loosely avoids the type mismatch between lucide's ForwardRef signature
// and a plain function component.
type IconComponent = ComponentType<{ size?: number }>;

interface Path {
  icon: IconComponent;
  kicker: string;
  title: string;
  body: string;
  cta: { label: string; href: string };
}

const PATHS: Path[] = [
  {
    icon: BookOpen,
    kicker: "Self-hosters",
    title: "Run it on your server.",
    body: "One compose file, GHCR images, opinionated defaults. Mount your /music directory, hit play. The docs walk you through the full stack.",
    cta: { label: "Read the docs", href: "https://docs.cratemusic.app" },
  },
  {
    icon: GithubIcon,
    kicker: "Contributors",
    title: "The repo is open.",
    body: "Python, TypeScript, Rust. The technical docs cover every subsystem. Open an issue, claim one, or start a PR — the codebase is deliberately readable.",
    cta: { label: "Browse the source", href: "https://github.com/diego-ninja/crate" },
  },
  {
    icon: MessageCircle,
    kicker: "Beta testers",
    title: "Shape what comes next.",
    body: "Crate is in private beta. If you run a homelab, care about your music library, and want to be early in shaping a real product — reach out on GitHub.",
    cta: {
      label: "Open a beta issue",
      href: "https://github.com/diego-ninja/crate/issues/new?title=Beta%20access%20request",
    },
  },
];

export function GetInvolved() {
  return (
    <section id="beta" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Join in
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          Three ways to show up.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate is not a closed beta looking for customers — it's an open project
          looking for the kind of people who will still be self-hosting things in ten
          years. Pick whichever role fits.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {PATHS.map(({ icon: Icon, kicker, title, body, cta }) => (
          <a
            key={title}
            href={cta.href}
            target={cta.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="group relative flex flex-col rounded-[22px] border border-white/10 bg-white/[0.03] p-7 transition hover:border-cyan-400/30 hover:bg-white/[0.05]"
          >
            <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
              <Icon size={19} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              {kicker}
            </div>
            <h3 className="mt-1.5 text-xl font-semibold text-white">{title}</h3>
            <p className="mt-3 text-[14.5px] leading-[1.65] text-white/60">{body}</p>
            <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-cyan-200">
              {cta.label}
              <ArrowRight size={15} className="transition group-hover:translate-x-1" />
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
