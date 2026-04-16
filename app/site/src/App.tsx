import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { ValueProps } from "@/components/ValueProps";
import { FeatureShowcase } from "@/components/FeatureShowcase";
import { UnderTheHood } from "@/components/UnderTheHood";
import { GetInvolved } from "@/components/GetInvolved";
import { Footer } from "@/components/Footer";

/**
 * The full marketing surface for Crate lives on one scrollable page —
 * enough sections to make the pitch, few enough that there's no hidden
 * navigation to hunt. The technical documentation lives at
 * docs.cratemusic.app and the code at github.com/diego-ninja/crate.
 */
export default function App() {
  return (
    <div className="grain relative min-h-screen">
      <Nav />
      <main>
        <Hero />
        <ValueProps />
        <FeatureShowcase />
        <UnderTheHood />
        <GetInvolved />
      </main>
      <Footer />
    </div>
  );
}
