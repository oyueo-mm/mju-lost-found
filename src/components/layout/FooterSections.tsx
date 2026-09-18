"use client";

import { useState } from "react";
import Link from "next/link";

type FooterSection = {
  title: string;
  links: { href: string; label: string }[];
};

const LINK_CLASS = "text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

export function FooterSections({ sections, legalLinks }: { sections: FooterSection[]; legalLinks: FooterSection["links"] }) {
  const [openSection, setOpenSection] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-1 md:hidden">
        {sections.map((section) => {
          const isOpen = openSection === section.title;
          const panelId = `footer-${section.title.replace(/\s+/g, "-").toLowerCase()}`;
          return (
            <section key={section.title} className="border-b border-border">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => setOpenSection((current) => (current === section.title ? null : section.title))}
                className="flex w-full items-center justify-between py-3 text-left text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {section.title}
                <span aria-hidden="true" className={`text-sm transition-transform motion-reduce:transition-none ${isOpen ? "rotate-45" : ""}`}>+</span>
              </button>
              <div id={panelId} hidden={!isOpen} className="pb-3">
                <nav aria-label={section.title} className="flex flex-col gap-2 text-xs">
                  {section.links.map((link) => <Link key={link.href} href={link.href} className={LINK_CLASS}>{link.label}</Link>)}
                </nav>
              </div>
            </section>
          );
        })}
      </div>

      <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs md:hidden">
        {legalLinks.map((link) => <Link key={link.href} href={link.href} className={LINK_CLASS}>{link.label}</Link>)}
      </nav>
    </>
  );
}
