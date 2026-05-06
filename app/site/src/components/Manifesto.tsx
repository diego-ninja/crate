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
        The Crate Manifesto
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.1]">
        The Crate Manifesto
      </h1>

      <div className="mt-12 space-y-6 text-[16px] leading-[1.85] text-white/65">
        <p>
          A while ago, I stopped feeling comfortable using the major streaming platforms. At first it was just a vague discomfort, the feeling that something no longer fit. Over time, it became painfully clear: the treatment of artists, the ruthless extraction logic, and business decisions that couldn't be separated from their political and cultural consequences. All of it piled up until the question was no longer "which service do I use?" but "what kind of system am I feeding?"
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Music has always meant everything to me. Not as background noise, not as functional ambience, not as another algorithm-driven playlist trying to keep me hooked for five more minutes. Music is discovery, context, obsession, memory, identity, and community.
        </p>

        <p>
          It became harder and harder to reconcile that deep relationship with platforms that turn music into a supply chain optimized for attention capture and corporate profit.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          The system isn't broken — it's working exactly as designed. Designed to extract value from artists and redistribute it upward. An independent musician needs hundreds of thousands of streams to earn what a single concert ticket costs. Fractions of a cent per play while the platforms hand billions to shareholders. The pro-rata model is a legal scam: your listens subsidize major label hits and executive bonuses.
        </p>

        <p>
          <b>Spotify is the largest extractor.</b> It pays artists less per stream than any competitor while spending billions on podcast exclusivity, stock buybacks, and military AI contracts. Apple Music and Amazon Music are loss leaders designed to sell hardware and Prime subscriptions — music is the bait, not the product. YouTube Music monetizes your attention and serves ads on independent artists' work without asking. These are not music companies. They are extraction companies that happen to sell access to music.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          In a system like this, piracy is not theft. It's self-defense.
        </p>

        <p>
          But let's be clear about what that means. This is not a call to stop paying artists. It's a call to stop paying middlemen. Pirate the catalog that the labels hold hostage — the music that already made its money ten times over. Then spend every cent you save on concert tickets, Bandcamp purchases, merch tables, and direct support. Pirate from the corporation. Pay the artist. The two acts belong together.
        </p>

        <p>
          The real theft happens every day, in plain sight, with terms of service and quarterly earnings reports. It happens when a platform pays an artist $0.003 per stream and calls it "democratizing music." It happens when algorithms bury the work of independent musicians under an endless sea of AI-generated filler and major-label playlist placements. It happens when the entire relationship between a listener and a musician is mediated by a corporation whose only incentive is to keep you scrolling.
        </p>

        <p>
          That's why more and more artists are saying <b>enough</b>. Massive Attack, King Gizzard & the Lizard Wizard, Godspeed You! Black Emperor, and others have pulled their music from Spotify — not just over the miserable payouts, but because they refuse to let their listeners' money fund a model that destroys culture and invests in military AI tech.
        </p>

        <p>
          The math is public. An artist with forty thousand monthly listeners on Spotify earns roughly a hundred dollars a month from streams. On Bandcamp Friday, selling thirty albums at ten dollars each puts two hundred and seventy dollars directly in the artist's hands. Same audience, thirty times the income. The platforms know this math. They're counting on you not doing it.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          This is bigger than music. It's the same logic that turns housing into investment vehicles, food delivery into gig exploitation, and personal data into surveillance products. The streaming economy is not an accident — it's a pattern. Platforms own the pipes, extract the value, and leave creators with scraps while calling it opportunity. Your listening history is not neutral. It's a commodity. Every skip, every repeat, every 3 AM playlist builds a profile that is bought and sold. With Crate, that data stays on your server. No corporation builds a profile on your taste. No algorithm nudges you toward whatever pays the highest royalty. Your attention is not the product.
        </p>

        <p>
          So yes: download the music. Build your library. Own your files. And then take the money you would have given to a streaming platform and spend it where it actually matters.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Buy the concert ticket. Buy the record at the merch table. Buy the t-shirt. Send the band a message telling them their album changed your week. Show up. That is how you support music. That is how you keep music alive. Not by adding another passive stream to a pool that pays artists less than minimum wage.
        </p>

        <hr className="my-10 border-white/8" />

        <h2 className="text-[20px] font-semibold leading-[1.4] text-white/90">
          What you can do today.
        </h2>

        <p className="text-[15px] leading-[1.75] text-white/55">
          No waiting. No "when the platform gets better." These are things you can do right now.
        </p>

        <ol className="space-y-5 pl-0 text-[16px] leading-[1.85] text-white/65">
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[13px] font-semibold text-cyan-200">
              1
            </span>
            <span>
              <b className="text-white/85">Delete your Spotify account.</b> Not deactivate. Delete. You can always come back — but take 30 days without it and notice what changes.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[13px] font-semibold text-cyan-200">
              2
            </span>
            <span>
              <b className="text-white/85">Go to Bandcamp. Buy 3 albums</b> from independent artists you love. Download the FLACs. Put them on your hard drive. That's the beginning of your library.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[13px] font-semibold text-cyan-200">
              3
            </span>
            <span>
              <b className="text-white/85">Tell 5 friends why you left.</b> Send them this manifesto. The most powerful thing you can do is make someone else do the math.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[13px] font-semibold text-cyan-200">
              4
            </span>
            <span>
              <b className="text-white/85">Go to a show this month.</b> Buy a t-shirt at the merch table. Tell the band their music matters. That conversation at the merch table is worth more than a million streams.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-[13px] font-semibold text-cyan-200">
              5
            </span>
            <span>
              <b className="text-white/85">If you can self-host:</b> install Crate. Your music, your server, your rules.{" "}
              <b className="text-white/85">If you can't:</b> find a friend who runs an instance. Join theirs. Build a community library together. Every file you own is a vote for a different kind of music economy.
            </span>
          </li>
        </ol>

        <hr className="my-10 border-white/8" />

        <p>
          This is not just a complaint. It is a call to reclaim what belongs to us. Music is not content. It is culture. And culture should not be rented.
        </p>

        <p>
          This is also not a solo project. It's a bet that small groups of people — friends, collectives, local scenes, people who will still be self-hosting things in ten years — can build their own infrastructure. Run a Crate instance for your community. Host a listening party. Share your library with your housemates. The goal isn't to replace Spotify with another monolith. It's to make the monolith irrelevant, one community server at a time.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Own your music. Support your artists. Refuse the middleman.
        </p>

        <div className="mt-8 text-right text-sm text-white/40">
          Started by one person who couldn't stomach it anymore. Now looking for people who understand we're building something different. Join and make it ours.
        </div>

        <hr className="my-10 border-white/8" />

        <div className="rounded-[20px] border border-cyan-400/20 bg-cyan-400/[0.04] p-7 text-center">
          <p className="text-[17px] font-semibold text-white">
            Ready to act?
          </p>
          <p className="mt-2 text-[15px] leading-relaxed text-white/55">
            The manifesto is the start. Self-hosting Crate is the next step. Run it
            on your own hardware, invite your friends, and turn your library into a
            platform your community actually owns.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://docs.cratemusic.app"
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-[#05161c] shadow-[0_0_20px_-4px_rgba(6,182,212,0.5)] transition hover:bg-cyan-300"
            >
              Self-host Crate
            </a>
            <a
              href="https://github.com/diego-ninja/crate"
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:text-white"
            >
              Browse the source
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
