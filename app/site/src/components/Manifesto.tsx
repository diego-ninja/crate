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
          A while ago, I stopped feeling comfortable using the major streaming platforms. At first it was just a vague discomfort, the feeling that something no longer fit. Over time, it became painfully clear: the treatment of artists, the ruthless extraction logic, and business decisions that couldn’t be separated from their political and cultural consequences. All of it piled up until the question was no longer “which service do I use?” but “what kind of system am I feeding?”
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Music has always meant everything to me. Not as background noise, not as functional ambience, not as another algorithm-driven playlist trying to keep me hooked for five more minutes. Music is discovery, context, obsession, memory, identity, and community.
        </p>

        <p>
          It became harder and harder to reconcile that deep relationship with platforms that turn music into a supply chain optimized for attention capture and corporate profit.
        </p>

        <hr className="my-10 border-white/8" />

        <p>
          The system isn’t broken — it’s working exactly as designed. Designed to extract value from artists and redistribute it upward. An independent musician needs hundreds of thousands of streams to earn what a single concert ticket costs. Fractions of a cent per play while the platforms hand billions to shareholders. The pro-rata model is a legal scam: your listens subsidize major label hits and executive bonuses.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          In a system like this, piracy is not theft. It's self-defense.
        </p>

        <p>
          The real theft happens every day, in plain sight, with terms of service and quarterly earnings reports. It happens when a platform pays an artist $0.003 per stream and calls it "democratizing music." It happens when algorithms bury the work of independent musicians under an endless sea of AI-generated filler and major-label playlist placements. It happens when the entire relationship between a listener and a musician is mediated by a corporation whose only incentive is to keep you scrolling.
        </p>

        <p>
          That’s why more and more artists are saying <b>enough</b>. Massive Attack, King Gizzard & the Lizard Wizard, Godspeed You! Black Emperor, and others have pulled their music from Spotify — not just over the miserable payouts, but because they refuse to let their listeners’ money fund a model that destroys culture and invests in military AI tech.
        </p>

        <p>
          So yes: download the music. Build your library. Own your files. And
          then take the money you would have given to a streaming platform and
          spend it where it actually matters.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Buy the concert ticket. Buy the record at the merch table. Buy the t-shirt. Send the band a message telling them their album changed your week. Show up. That is how you support music. That is how you keep music alive. Not by adding another passive stream to a pool that pays artists less than minimum wage.
        </p>

        <p>
          This is not just a complaint. It is a call to reclaim what belongs to us. Music is not content. It is culture. And culture should not be rented.
        </p>

        <p className="text-[18px] font-medium leading-[1.7] text-white/85">
          Own your music. Support your artists. Refuse the middleman.
        </p>

        <div className="mt-8 text-right text-sm text-white/40">
          — The Crate Squad
        </div>
      </div>
    </article>
  );
}
