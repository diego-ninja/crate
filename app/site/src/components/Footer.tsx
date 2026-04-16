import { GithubIcon } from "./GithubIcon";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative border-t border-white/6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-3">
          <img src="/icons/logo.svg" alt="" className="h-7 w-7" />
          <div>
            <div className="text-sm font-semibold text-white">Crate</div>
            <div className="text-[12px] text-white/40">
              A home for the music you actually own.
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-5 text-[13px] text-white/50">
          <a
            href="https://docs.cratemusic.app"
            className="transition hover:text-white"
          >
            Documentation
          </a>
          <a
            href="https://github.com/diego-ninja/crate"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition hover:text-white"
          >
            <GithubIcon size={13} />
            GitHub
          </a>
          <span className="text-white/30">© {year} Diego Rin Martín</span>
        </div>
      </div>
    </footer>
  );
}
