import { ArrowLeft } from "lucide-react";

export function Manifesto() {
  return (
    <article className="relative mx-auto max-w-[720px] px-5 py-16 sm:px-8 sm:py-24">
      <a
        href="/"
        className="mb-12 inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white"
      >
        <ArrowLeft size={14} /> Back to home
      </a>

      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
        Why Crate?
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.1]">
        The Music Freedom Manifesto
      </h1>

      <div className="mt-12 space-y-6 text-[16px] leading-[1.85] text-white/65">
        <p>
          A while ago, I stopped feeling comfortable using the major streaming
          platforms. At first it was just a vague discomfort, the feeling that
          something no longer fit. Over time, it became much clearer. The
          treatment of artists, the extraction logic, certain business decisions
          that couldn't be separated from their political and cultural
          consequences. All of it kept piling up until the question was no
          longer "which service do I use to listen to music?" but "what kind of
          system am I choosing to feed?"
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Music has always meant a great deal to me. Not as background noise,
          not as functional ambience, not as one more playlist pushed by an
          algorithm trying to keep me engaged for five more minutes. For me,
          music is still discovery, context, obsession, memory, identity,
          community.
        </p>

        <p>
          And it became harder and harder to reconcile that relationship with
          platforms that turn it into a supply chain optimized for attention
          capture and profit.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          Let's be honest about what the streaming economy actually does to
          music. An artist needs roughly 25,000 streams on Spotify to earn what a
          single concert ticket costs. A band touring in a van, sleeping on
          floors, pouring everything into their art, gets fractions of a cent
          while a platform's shareholders collect billions. The model isn't
          broken — it's working exactly as designed. It's just not designed for
          artists. It's designed to extract value from their work and
          redistribute it upward.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          In a system like this, piracy is not theft. It's self-defense.
        </p>

        <p>
          The real theft happens every day, in plain sight, with terms of
          service and quarterly earnings reports. It happens when a platform
          pays an artist $0.003 per stream and calls it "democratizing music."
          It happens when algorithms bury the work of independent musicians
          under an endless sea of AI-generated filler and major-label playlist
          placements. It happens when the entire relationship between a
          listener and a musician is mediated by a corporation whose only
          incentive is to keep you scrolling.
        </p>

        <p>
          So yes: download the music. Build your library. Own your files. And
          then take the money you would have given to a streaming platform and
          spend it where it actually matters.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Buy the concert ticket. Buy the record at the merch table. Buy the
          t-shirt. Send the band a message telling them their album changed
          your week. Show up. That is how you support music. Not by adding
          another passive stream to a pool that pays artists less than minimum
          wage.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          That was when I started looking seriously at self-hosted software. I
          wanted to recover something simple and valuable: the feeling that my
          music library belonged to me again. I tried excellent tools, and
          through that journey I found projects like Navidrome, which I
          genuinely think is extraordinary software. Lightweight, elegant,
          efficient, sensible. It showed me that another way of listening to
          music was possible.
        </p>

        <p>
          But it also showed me something else: I wasn't just looking for a
          music server. I was looking for a complete platform. An experience
          that would treat my collection as something alive. Something that
          would help me discover, connect, contextualize, analyze, and care for
          a library built over many years. I didn't simply want to "play
          files." I wanted a home for music.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          For a long time, that idea just lived in my head. Like most ideas
          that truly matter, it refused to disappear. It kept growing
          underneath everything else. But there was also parenthood, work,
          exhaustion, and the ordinary friction of adult life that can make even
          the most exciting project feel impossible to begin.
        </p>

        <p>
          At the same time, the way I build software had already been changing
          for years. I started with tools like Copilot and gradually moved
          toward more powerful models and workflows increasingly shaped by
          agents. The terminal started replacing the IDE. GitHub mattered more
          than the editor. And my work itself began to change: less manual
          coding, more thinking about systems, product, architecture,
          interfaces, and direction. Less "traditional programmer," more
          orchestrator of agents, reviewer of code, and decision-maker.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          So eventually the obvious question arrived: if this new way of
          building software really works, could I use it to create, from
          scratch, the streaming platform I've always wanted to have?
        </p>

        <p>That is how Crate began.</p>

        <hr className="my-10 border-white/8" />

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Crate is built on a simple belief: music deserves better than the
          dominant platforms. It deserves tools built with respect for artists,
          with love for collections, with curiosity for discovery, and with the
          conviction that listening should not require surrendering yourself
          completely to the rules of a handful of giant companies.
        </p>

        <p>
          It also comes out of a very personal experiment: building a complex,
          ambitious, real product without writing code by hand in the
          traditional sense. Crate did not emerge from a marathon IDE session.
          It emerged from long conversations, brainstorming, planning
          documents, constant iteration, revision, correction, and sustained
          collaboration with AI models. My work has been to imagine, decide,
          refine, prioritize, direct, and demand. Much of the mechanical
          execution has been done by agents.
        </p>

        <p>
          That does not make the project less human. For me, it does the
          opposite. Crate feels deeply human because it comes from a very
          personal obsession: building the kind of product I, as a complete
          music obsessive, have always wanted to use. A place where the library
          matters. Where discovering music feels exciting again. Where albums,
          artists, genres, connections, and stories still have weight. Where
          the experience is not designed to strip music of meaning, but to give
          some of that meaning back.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          Crate is still early. Many things are missing. Others already exist,
          but still don't work as well as they should. There is a lot left to
          refine, rethink, and build. But even in this early state, Crate
          already stands for an idea I care deeply about: that we can build
          better tools, more intimate tools, more honest tools, and tools that
          feel like they are truly ours.
        </p>

        <p>
          I don't want this to remain only a personal project. I want Crate to
          be surrounded by curious, demanding people who genuinely love music.
          Developers, beta testers, self-hosters, collectors, audio obsessives,
          people who still believe that listening to music can be more than
          consuming an endless stream of interchangeable recommendations.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          If any of this resonates with you, you're invited. To try it,
          question it, challenge it, improve it, and help push it forward.
          Crate is not being built to replicate what already exists. It is
          being built to imagine something better.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Own your music. Support your artists. Refuse the middleman.
        </p>

        <div className="mt-8 text-right text-sm text-white/40">
          — Diego Rin Martin
        </div>
      </div>
    </article>
  );
}
