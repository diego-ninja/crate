export function WhyCrateTeaser() {
  return (
    <section
      id="why-crate"
      className="relative mx-auto max-w-[1400px] px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="border-y border-white/8 py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-16">
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
              Why Crate?
            </div>
            <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
              Why this exists.
            </h2>
          </div>

          <div className="max-w-2xl">
            <p className="text-[16px] leading-8 text-white/62">
              Crate started with my own library, and with a growing discomfort around
              renting music from platforms that do not care much about artists or listeners.
              The longer story has its own page.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="/why-crate"
                className="inline-flex rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-200"
              >
                Read why Crate exists
              </a>
              <a
                href="/why"
                className="inline-flex rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:text-white"
              >
                Read the manifesto
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
