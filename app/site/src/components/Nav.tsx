import { GithubIcon } from "./GithubIcon";

export function Nav() {
  return (
    <header className="relative z-20 mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-5 sm:px-8">
      <a href="/" className="flex items-center gap-2.5">
        <img src="/icons/logo.svg" alt="" className="h-8 w-8" />
        <span className="text-[15px] font-semibold tracking-tight text-white">Crate</span>
      </a>

      <nav className="ml-auto flex items-center gap-1">
        <a
          href="#features"
          className="hidden rounded-full px-3 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white sm:block"
        >
          Features
        </a>
        <a
          href="#stack"
          className="hidden rounded-full px-3 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white sm:block"
        >
          Stack
        </a>
        <a
          href="#install"
          className="hidden rounded-full px-3 py-2 text-sm text-white/60 transition hover:bg-white/5 hover:text-white sm:block"
        >
          Install
        </a>
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
    </header>
  );
}
