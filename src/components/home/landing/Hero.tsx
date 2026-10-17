import Link from "next/link";

import { HomeSearchBar } from "@/components/home/HomeSearchBar";
import { HandboxIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/Button";
import { getTranslator } from "@/lib/i18n/server";

// The logged-out visitor's first screen. Searching is the first thing to
// do, not signing in: the same natural-language search the signed-in home
// shows (HomeSearchBar -- AI search over found items, photo optional, results
// right below; the API allows it without an account, rate-limited per
// hashed IP) sits right under the headline. Posting a found item is the
// second action (/found/new sends a signed-out visitor through the usual
// sign-in and back via callbackUrl), and signing in is a plain text link.
// A soft blurred glow behind the copy is the only decoration.
export async function Hero() {
  const t = await getTranslator();

  return (
    <section className="relative flex flex-col items-center gap-4 overflow-hidden px-1 pt-6 pb-4 text-center md:gap-6 md:pt-14">
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-72 w-72 -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/10 blur-3xl md:h-96 md:w-96"
      />

      <span className="rounded-full bg-primary-muted px-3 py-1 text-xs font-medium text-primary">{t("landing.badge")}</span>

      <h1 className="max-w-2xl text-2xl leading-snug font-bold text-balance text-foreground md:text-4xl md:leading-tight">
        {t("landing.searchHeadline")}
      </h1>

      <p className="max-w-md text-sm text-muted-foreground md:max-w-xl md:text-base">{t("landing.subtitle")}</p>

      {/* The search itself. The id is what LandingStickyCta watches: once
          this has scrolled away, its floating "find" button takes over. */}
      <div id="landing-hero-cta" className="w-full max-w-2xl text-left">
        <HomeSearchBar />
      </div>

      <div className="flex flex-col items-center gap-2">
        <LinkButton href="/found/new" variant="secondary" size="sm" className="gap-1.5 bg-muted/60 hover:bg-muted">
          <HandboxIcon className="size-4" /> {t("landing.registerFound")}
        </LinkButton>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {t("landing.accessNote")}{" "}
          <Link href="/login" className="font-medium whitespace-nowrap text-primary hover:opacity-80">
            {t("landing.cta")}
          </Link>
        </p>
      </div>
    </section>
  );
}
