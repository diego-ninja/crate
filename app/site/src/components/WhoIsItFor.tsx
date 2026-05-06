import { BookOpen, Server, Smartphone } from "lucide-react";

interface Audience {
  icon: typeof Server;
  kicker: string;
  title: string;
  body: string;
}

const AUDIENCES: Audience[] = [
  {
    icon: Server,
    kicker: "The self-hoster",
    title: "You already run a few things yourself.",
    body: "Crate fits best if you are comfortable with Docker, storage, backups, and a bit of maintenance. It is not pretending to be zero-effort. It is for people who would rather own the system than rent the convenience.",
  },
  {
    icon: Smartphone,
    kicker: "The music lover",
    title: "You want out of streaming, but you still want a decent app.",
    body: "You do not have to run the server yourself. You can use an instance run by someone you trust, sign in, and listen from your phone without giving your habits to another platform.",
  },
  {
    icon: BookOpen,
    kicker: "The collector",
    title: "You have a library that took years to build.",
    body: "Crate tries to treat that work with care: stable identities, artwork, tags, lyrics, fingerprints, analysis, and enough metadata to recover from messy paths or a broken database.",
  },
];

export function WhoIsItFor() {
  return (
    <section className="relative mx-auto max-w-[1400px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mb-12 max-w-2xl">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Who it's for
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-[44px] sm:leading-[1.05]">
          A few people this might suit.
        </h2>
        <p className="mt-4 text-base leading-7 text-white/60 sm:text-lg">
          Crate is not for everyone, and that is fine. It makes the most sense when
          owning the library matters more than having the easiest possible setup.
        </p>
      </div>

      <div className="grid gap-10 md:grid-cols-3">
        {AUDIENCES.map(({ icon: Icon, kicker, title, body }) => (
          <article
            key={kicker}
            className="group border-t border-white/10 pt-6"
          >
            <div className="mb-5 text-cyan-300">
              <Icon size={19} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
              {kicker}
            </div>
            <h3 className="mt-2 text-[17px] font-semibold leading-[1.45] text-white">
              {title}
            </h3>
            <p className="mt-3 text-[14.5px] leading-[1.65] text-white/60">{body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
