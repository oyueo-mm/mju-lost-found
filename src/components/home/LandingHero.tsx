import { Hero } from "./landing/Hero";
import { FeatureGrid } from "./landing/FeatureGrid";
import { AiSearchShowcase } from "./landing/AiSearchShowcase";
import { ImageSearchShowcase } from "./landing/ImageSearchShowcase";
import { HowItWorks } from "./landing/HowItWorks";
import { FinalCta } from "./landing/FinalCta";

// Phase 29 introduced this as the logged-out visitor's very first screen
// (replacing the full dashboard Home() normally shows -- see page.tsx's
// own comment on that branch). Phase 30 expands it from a single Hero
// into a scrollable landing page; the component name/export/import path
// stay the same on purpose so page.tsx's branch didn't need to change at
// all this phase.
export function LandingHero() {
  return (
    <div className="flex flex-col">
      <Hero />
      <FeatureGrid />
      <div className="flex flex-col gap-6 py-6 md:gap-8">
        <AiSearchShowcase />
        <ImageSearchShowcase />
      </div>
      <HowItWorks />
      <FinalCta />
    </div>
  );
}
