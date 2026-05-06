import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

const STORY_BLOCKS: ReactNode[][] = [
  [
    "For a long time, I wanted my music library to feel like mine again. Not as a folder I occasionally searched through, but as something I could live with every day.",
    <>
      After trying several excellent self-hosted tools, I discovered projects like{" "}
      <strong className="font-semibold text-white/82">Navidrome</strong> — outstanding
      software that is lightweight, elegant, and thoughtfully designed. It reminded me
      that self-hosted music could be pleasant, not just possible.
    </>,
    "It also showed me what I personally missed: more context, more discovery, and better tools for taking care of a collection that had taken years to build.",
  ],
  [
    "The idea stayed around. It kept coming back between work, parenthood, and the usual tiredness of adult life. At the same time, the way I build software changed: less solo typing, more planning, reviewing, and directing AI agents through concrete work.",
    <>
      Eventually, the obvious question arose:{" "}
      <strong className="font-semibold text-white/86">
        If this way of building actually works, could I use it to make the music tool
        I kept wishing existed?
      </strong>
    </>,
    "That’s how Crate was born.",
  ],
  [
    "Crate is built around a simple frustration: music tools often ask you to give up too much. Your files, your habits, your discovery, your relationship with artists. I wanted something that kept more of that close.",
    "It is being built in a slightly unusual way, with a lot of planning and a lot of AI-assisted implementation. That does not make the work magic. It still needs taste, review, testing, and people willing to say when something feels wrong.",
    "The project is early. Some parts are already useful, some are rough, and some are still ideas. That is the honest state of it.",
  ],
  [
    <>
      <strong className="font-semibold text-white/86">
        I’m looking for developers, self-hosters, and music people
      </strong>{" "}
      who are willing to try it, question it, and help shape it. Strong opinions are useful here.
    </>,
    "If you care about self-hosted music, own-your-data tools, Go, React, TypeScript, Docker, or just the idea of taking back control of a music collection, you can help.",
    "Try it, break it, criticize it, suggest something better, or build a piece of it.",
  ],
];

export function WhyCrate() {
  return (
    <article className="relative mx-auto max-w-[1400px] px-5 py-16 sm:px-8 sm:py-24">
      <a
        href="/"
        className="mb-12 inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white"
      >
        <ArrowLeft size={14} /> Back to home
      </a>

      <div className="pointer-events-none absolute inset-x-5 top-16 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent sm:inset-x-8" />

      <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
        <div className="lg:sticky lg:top-10 lg:self-start">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Why Crate?
          </div>
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-[48px] sm:leading-[1.02]">
            Why I started building this.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-white/58">
            Crate started with my own library, and with a growing discomfort around
            renting music from platforms that do not care much about artists or listeners.
          </p>

          <div className="mt-8 border-l border-cyan-300/35 pl-5">
            <p className="text-[15px] font-medium leading-7 text-white/82">
              It is not finished, and it is not trying to be everything.
              <span className="block text-cyan-200">It is a way to take one small piece back.</span>
            </p>
          </div>
        </div>

        <div className="relative">
          <div className="space-y-10">
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

            <div className="border-t border-white/10 pt-8">
              <p className="text-[18px] font-semibold leading-8 text-white sm:text-xl">
                If this matters to you, come poke at it.
              </p>
              <p className="mt-3 text-[15px] leading-7 text-white/58">
                Try the current version, open issues, propose changes, or just tell me
                where the assumptions do not match your library.
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
    </article>
  );
}
