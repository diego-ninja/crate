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
    title: "Try it on your server.",
    body: "The docs explain the compose setup, volumes, domains, and first run. It is still early, so expect to read a bit and make decisions.",
    cta: { label: "Read the docs", href: "https://docs.cratemusic.app" },
  },
  {
    icon: GithubIcon,
    kicker: "Contributors",
    title: "Look around the code.",
    body: "The repo mixes Python, TypeScript, Go, and Rust. There is plenty to improve, and the project is more useful when more people can understand it.",
    cta: { label: "Browse the source", href: "https://github.com/thecrateapp/crate" },
  },
  {
    icon: MessageCircle,
    kicker: "Community",
    title: "Tell us what feels wrong.",
    body: "Weird libraries, failed imports, confusing UI, bad assumptions. That feedback matters more than generic praise.",
    cta: {
      label: "Open an issue",
      href: "https://github.com/thecrateapp/crate/issues/new",
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
          Ways to take part.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate is not looking for customers. It needs people willing to run it,
          question it, and help make it less fragile.
        </p>
      </div>

      <div className="grid gap-10 md:grid-cols-3">
        {PATHS.map(({ icon: Icon, kicker, title, body, cta }) => (
          <a
            key={title}
            href={cta.href}
            target={cta.href.startsWith("http") ? "_blank" : undefined}
            rel="noreferrer"
            className="group flex flex-col border-t border-white/10 pt-6 transition hover:border-cyan-400/35"
          >
            <div className="mb-5 text-cyan-300">
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
