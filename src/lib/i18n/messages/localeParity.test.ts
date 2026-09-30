import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { en } from "./en";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { mn } from "./mn";
import { vi } from "./vi";
import { zh } from "./zh";

describe("locale dictionary parity", () => {
  it("exposes every Korean dictionary key in all supported locales", () => {
    const keySet = Object.keys(ko).sort();
    expect(keySet).toHaveLength(604);

    for (const dictionary of [en, zh, vi, mn, ja, fr]) {
      expect(Object.keys(dictionary).sort()).toEqual(keySet);
    }
  });

  it("keeps Japanese and French independent from the English dictionary", () => {
    for (const locale of ["ja", "fr"] as const) {
      const source = readFileSync(new URL(`./${locale}.ts`, import.meta.url), "utf8");
      expect(source).not.toMatch(/\.\.\.en\b/);
      expect(source).not.toMatch(/from\s+["']\.\/en["']/);
    }
  });

  it("only shares language-neutral or identical French terms with English", () => {
    const identicalKeys = (dictionary: Partial<Record<keyof typeof en, string>>) =>
      (Object.keys(en) as Array<keyof typeof en>)
        .filter((key) => {
          const englishValue = en[key];
          return typeof englishValue === "string" && dictionary[key] === englishValue && /[A-Za-z]/.test(englishValue);
        })
        .sort();

    expect(identicalKeys(ja)).toEqual(["auth.login.title", "brand.name", "brand.shortName", "landing.headlineAi"]);
    expect(identicalKeys(fr)).toEqual([
      "auth.login.title",
      "brand.name",
      "brand.shortName",
      "chatThread.photo",
      "footer.link.notifications",
      "footer.section.service",
      "form.campus",
      "form.description",
      "form.photos",
      "me.notifications",
      "nav.mobile.admin",
      "nav.mobile.chat",
      "nav.notifications",
      "notification.title",
      "organization.description",
      "organization.inactive",
      "report.reason.spam",
      "search.filter.campus",
      "theme.accent.rose",
    ]);
  });

  it("uses concise French labels in the mobile navigation", () => {
    expect([
      fr["nav.mobile.home"],
      fr["nav.mobile.lost"],
      fr["nav.mobile.found"],
      fr["nav.mobile.chat"],
      fr["nav.mobile.me"],
      fr["nav.mobile.admin"],
    ]).toEqual(["Accueil", "Perdus", "Trouvés", "Chat", "Profil", "Admin"]);
  });
});
