import type { ReactNode } from "react";

const STORY_BLOCKS: ReactNode[][] = [
  [
    "For a long time, I wanted to regain control and joy over my music library. I was looking for something simple yet profound: a place where my collection truly felt like mine again.",
    <>
      After trying several excellent self-hosted tools, I discovered projects like{" "}
      <strong className="font-semibold text-white/82">Navidrome</strong> — outstanding
      software that is lightweight, elegant, and thoughtfully designed. It proved to me
      that a different way of listening was possible.
    </>,
    "But it also made me realize I wasn’t looking for just another music server. I wanted a complete platform — a living home for my library. A place that would support discovery, context, connections, and care for a collection built over many years. Not just playing files, but truly living with the music.",
  ],
  [
    "That idea never went away. It kept growing quietly, even through work, parenthood, and the exhaustion of adult life. At the same time, my approach to building software had fundamentally changed. I moved from traditional coding to orchestrating powerful AI agents. The terminal replaced the IDE. My role evolved from hands-on programmer to product designer, architect, and director of systems.",
    <>
      Eventually, the obvious question arose:{" "}
      <strong className="font-semibold text-white/86">
        If this new way of building software actually works, could I use it to create the
        streaming platform I had always dreamed of?
      </strong>
    </>,
    "That’s how Crate was born.",
  ],
  [
    "Crate is an ambitious project built on a clear belief: music deserves better tools — tools made with respect for artists, love for personal collections, and genuine curiosity for discovery. Tools that don’t force you to surrender your experience to giant corporations.",
    "Crate is being developed in a non-traditional way: through deep planning, constant iteration, and close collaboration with AI models. Much of the technical execution is handled by agents, while I focus on vision, architecture, product direction, and quality.",
    "The project is still in its early stages. There’s a lot left to build, refine, and rethink. And this is exactly where you come in.",
  ],
  [
    <>
      <strong className="font-semibold text-white/86">
        I’m actively looking for developers, beta testers, self-hosters, and passionate
        music lovers
      </strong>{" "}
      to join the project. Curious, demanding people with strong opinions. People who
      understand we’re building something different: a personal, honest, and deep platform
      for serious music libraries.
    </>,
    "If you care about self-hosted music, own-your-data tools, Go, React, TypeScript, Docker, or simply love the idea of taking back control of your music collection, I would love to have you involved.",
    "I’m not looking for passive users. I’m looking for people who want to test, break, criticize, suggest, and build alongside me.",
  ],
];

export function WhyCrate() {
  return (
    <section id="why-crate" className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="pointer-events-none absolute inset-x-5 top-16 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent sm:inset-x-8" />

      <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
        <div className="lg:sticky lg:top-10 lg:self-start">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Why Crate?
          </div>
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-[48px] sm:leading-[1.02]">
            A living home for serious music libraries.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-white/58">
            Crate started as a personal need, but the shape of the project is bigger than
            one library: control, context, discovery, and a better way to care for music.
          </p>

          <div className="mt-8 rounded-[24px] border border-cyan-300/18 bg-cyan-300/[0.055] p-5 shadow-[0_0_80px_rgba(6,182,212,0.08)]">
            <p className="text-[15px] font-medium leading-7 text-white/82">
              Crate is not here to replicate what already exists.
              <span className="block text-cyan-200">It’s here to imagine something better.</span>
            </p>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.028] p-6 sm:p-9 lg:p-11">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/4 h-72 w-72 rounded-full bg-white/5 blur-3xl" />

          <div className="relative space-y-10">
            {STORY_BLOCKS.map((paragraphs, index) => (
              <div
                key={index}
                className="border-l border-white/10 pl-5 text-[15.5px] leading-[1.82] text-white/64 sm:pl-7 sm:text-[16px]"
              >
                <div className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/32">
                  0{index + 1}
                </div>
                <div className="space-y-5">
                  {paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={paragraphIndex}>{paragraph}</p>
                  ))}
                </div>
              </div>
            ))}

            <div className="rounded-[26px] border border-white/10 bg-black/20 p-6 sm:p-7">
              <p className="text-[18px] font-semibold leading-8 text-white sm:text-xl">
                Music needs better tools. Let’s build them together.
              </p>
              <p className="mt-3 text-[15px] leading-7 text-white/58">
                If this resonates with you, join us. Try the current version, open issues,
                propose features, or simply tell me how you’d like it to evolve.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="https://github.com/diego-ninja/crate"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex rounded-full bg-cyan-300 px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-cyan-200"
                >
                  Browse the source
                </a>
                <a
                  href="/#beta"
                  className="inline-flex rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:text-white"
                >
                  Get involved
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
