import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ValueProps } from "@/components/ValueProps";
import { FeatureShowcase } from "@/components/FeatureShowcase";
import { MusicPaths } from "@/components/MusicPaths";
import { UnderTheHood } from "@/components/UnderTheHood";
import { GetApp } from "@/components/GetApp";
import { GetInvolved } from "@/components/GetInvolved";
import { Footer } from "@/components/Footer";
import { Manifesto } from "@/components/Manifesto";

function WhyTeaser() {
  return (
    <section className="relative mx-auto max-w-[1400px] px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
          Why Crate?
        </div>
        <blockquote className="text-xl font-medium leading-relaxed text-white/80 sm:text-2xl sm:leading-relaxed">
          "Music has always meant a great deal to me. Not as background noise,
          not as functional ambience. For me, music is still discovery, context,
          obsession, memory, identity, community."
        </blockquote>
        <p className="mt-6 text-[15px] leading-7 text-white/50">
          Crate is built on a simple belief: music deserves better than the
          dominant platforms. It deserves tools built with respect for artists,
          with love for collections, and with the conviction that listening
          should not require surrendering yourself to the rules of a handful
          of giant companies.
        </p>
        <a
          href="/why"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-cyan-300 transition hover:text-cyan-200"
        >
          Read the full manifesto
          <span className="transition group-hover:translate-x-0.5">→</span>
        </a>
      </div>
    </section>
  );
}

function HomePage() {
  return (
    <>
      <Hero />
      <WhyTeaser />
      <ValueProps />
      <FeatureShowcase />
      <MusicPaths />
      <UnderTheHood />
      <GetApp />
      <GetInvolved />
    </>
  );
}

export default function App() {
  const isManifesto = window.location.pathname === "/why";

  return (
    <div className="grain relative min-h-screen">
      <Nav />
      <main>
        {isManifesto ? <Manifesto /> : <HomePage />}
      </main>
      <Footer />
    </div>
  );
}
