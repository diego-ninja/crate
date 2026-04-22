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
          "In a system where artists earn $0.003 per stream while platforms
          collect billions, piracy is not theft. It's self-defense."
        </blockquote>
        <p className="mt-6 text-[15px] leading-7 text-white/50">
          Buy the concert ticket. Buy the record at the merch table. Send the
          band a message. That is how you support music. Not by feeding a
          system designed to extract value from artists and redistribute it
          upward.
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
