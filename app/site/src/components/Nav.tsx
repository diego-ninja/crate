import { useState } from "react";
import { Menu, X } from "lucide-react";
import { GithubIcon } from "./GithubIcon";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#stack", label: "Stack" },
  { href: "#install", label: "Install" },
  { href: "/why", label: "Why Crate?" },
];

export function Nav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="relative z-20 mx-auto max-w-[1400px] px-5 sm:px-8">
      <div className="flex h-16 items-center gap-6">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/icons/logo.svg" alt="" className="h-8 w-8" />
          <span className="text-[15px] font-semibold tracking-tight text-white">Crate</span>
        </a>

        {/* Desktop nav */}
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://docs.cratemusic.app"
            className="rounded-full px-3 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
          >
            Docs
          </a>
          <a
            href="https://github.com/diego-ninja/crate"
            target="_blank"
            rel="noreferrer"
            className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/75 transition hover:border-white/20 hover:text-white"
          >
            <GithubIcon size={14} />
            GitHub
          </a>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="ml-auto rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white sm:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <nav className="flex flex-col gap-1 border-t border-white/8 pb-4 pt-2 sm:hidden">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://docs.cratemusic.app"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm text-white/70 transition hover:bg-white/5 hover:text-white"
          >
            Docs
          </a>
          <a
            href="https://github.com/diego-ninja/crate"
            target="_blank"
            rel="noreferrer"
            onClick={() => setMobileOpen(false)}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/75 transition hover:border-white/20 hover:text-white"
          >
            <GithubIcon size={14} />
            GitHub
          </a>
        </nav>
      )}
    </header>
  );
}
