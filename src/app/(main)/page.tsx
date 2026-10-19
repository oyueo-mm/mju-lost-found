import { getCurrentUser } from "@/lib/auth/session";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { CategoryShortcuts } from "@/components/home/CategoryShortcuts";
import { LandingHero } from "@/components/home/LandingHero";
import { Hero } from "@/components/home/landing/Hero";
import { LandingStats } from "@/components/home/landing/LandingStats";
import { RecentPostsSections } from "@/components/home/RecentPostsSections";
import { getTranslator } from "@/lib/i18n/server";

// Home. Public, no auth gate: the session only decides what follows the
// first screen.
//
// Both start with the same first screen, so signing in never feels like
// arriving at another service: Hero (the two-line headline, the one-line
// subtitle, the AI search with its popular searches, the blue glow, and the
// 분실물·습득물 등록 buttons -- signed out, those go through sign-in and back to
// the form; signed in, straight to the form), then LandingStats (the real
// registration counts and the links into the two boards).
//
// Both then show the newest lost / found posts as two slowly drifting card
// rows (RecentPostsSections) -- signed in after the category shortcuts,
// signed out before the landing story (LandingHero: features and the demos
// of posting, AI search, matching).
//
// The search itself is unchanged: AI search over found posts
// (HomeSearchBar); the mode toggle and board choice stay on /search,
// /lost and /found.
export default async function Home() {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslator()]);
  if (!user) {
    return <LandingHero />;
  }

  return (
    <div className="flex flex-col">
      <Hero />
      <LandingStats />

      {/* Each section below fades up the first time it's scrolled to
          (ScrollReveal -- no-op for content already on screen and for
          prefers-reduced-motion). */}
      <div className="flex flex-col gap-10 pt-6 md:pt-8">
        <ScrollReveal className="flex flex-col gap-4 text-center">
          <h2 className="text-lg font-semibold text-foreground">{t("home.categories.title")}</h2>
          <CategoryShortcuts />
        </ScrollReveal>

        <RecentPostsSections />
      </div>
    </div>
  );
}
