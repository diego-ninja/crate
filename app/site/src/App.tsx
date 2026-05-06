import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { FeatureShowcase } from "@/components/FeatureShowcase";
import { WhatIsCrate } from "@/components/WhatIsCrate";
import { ValueProps } from "@/components/ValueProps";
import { WhoIsItFor } from "@/components/WhoIsItFor";
import { Screenshots } from "@/components/Screenshots";
import { Comparison } from "@/components/Comparison";
import { MusicPaths } from "@/components/MusicPaths";
import { UnderTheHood } from "@/components/UnderTheHood";
import { GetInvolved } from "@/components/GetInvolved";
import { Footer } from "@/components/Footer";
import { Manifesto } from "@/components/Manifesto";
import { WhyCrate } from "@/components/WhyCrate";
import { WhyCrateTeaser } from "@/components/WhyCrateTeaser";

const SHOW_MUSIC_PATHS = false;

function StickyCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY > 400;
      const nearBottom =
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 200;
      setVisible(scrolled && !nearBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-30 border-t border-white/8 bg-[#07070b]/95 backdrop-blur-md transition-transform duration-300 ${
        visible ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-3 sm:px-8">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/icons/logo.svg" alt="" className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-white">Crate</span>
            <span className="ml-3 hidden text-[12px] text-white/35 sm:inline">
              Own your music. Support your artists. Refuse the middleman.
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <a
            href="https://docs.cratemusic.app"
            className="rounded-full bg-cyan-400 px-4 py-2 text-[13px] font-semibold text-[#05161c] shadow-[0_0_16px_-4px_rgba(6,182,212,0.5)] transition hover:bg-cyan-300"
          >
            Self-host Crate
          </a>
        </div>
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <>
      <Hero />
      <FeatureShowcase />
      <WhatIsCrate />
      <Screenshots />
      <ValueProps />
      <WhoIsItFor />
      <WhyCrateTeaser />
      <Comparison />
      {SHOW_MUSIC_PATHS ? <MusicPaths /> : null}
      <UnderTheHood />
      <GetInvolved />
    </>
  );
}

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  const isManifesto = pathname === "/why";
  const isWhyCrate = pathname === "/why-crate";

  return (
    <div className="grain relative min-h-screen">
      <Nav />
      <main>
        {isManifesto ? <Manifesto /> : isWhyCrate ? <WhyCrate /> : <HomePage />}
      </main>
      <Footer />
      <StickyCTA />
    </div>
  );
}
