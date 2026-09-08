import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { Hero } from "./landing/Hero";
import { FeatureGrid } from "./landing/FeatureGrid";
import { AiSearchShowcase } from "./landing/AiSearchShowcase";
import { ImageSearchShowcase } from "./landing/ImageSearchShowcase";
import { HowItWorks } from "./landing/HowItWorks";
import { FinalCta } from "./landing/FinalCta";
import { LandingStickyCta } from "./landing/LandingStickyCta";

// Phase 29 introduced this as the logged-out visitor's very first screen
// (replacing the full dashboard Home() normally shows -- see page.tsx's
// own comment on that branch). Phase 30 expands it from a single Hero
// into a scrollable landing page; the component name/export/import path
// stay the same on purpose so page.tsx's branch didn't need to change at
// all this phase.
//
// Phase K: the sections themselves are untouched -- each is only wrapped
// in ScrollReveal so it fades up the first time it's scrolled to, and the
// floating CTA is added for the long middle stretch where neither the
// hero's nor the final CTA is on screen. The Hero is deliberately NOT
// wrapped: the first screen should be there instantly, not arrive.
export function LandingHero() {
  return (
    <div className="flex flex-col">
      <Hero />

      <ScrollReveal>
        <FeatureGrid />
      </ScrollReveal>

      <div className="flex flex-col gap-6 py-6 md:gap-8">
        <ScrollReveal>
          <AiSearchShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <ImageSearchShowcase />
        </ScrollReveal>
      </div>

      <ScrollReveal>
        <HowItWorks />
      </ScrollReveal>

      <ScrollReveal>
        <FinalCta />
      </ScrollReveal>

      <LandingStickyCta />
    </div>
  );
}
