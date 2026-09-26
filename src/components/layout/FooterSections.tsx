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

      {/* Footer 안내 섹션 정리 Phase: 정책 링크(이용약관/개인정보처리방침/
          운영정책) 전용 영역 -- 예전에는 모바일에만 있었고(md:hidden),
          안내 아코디언 안에도 같은 3개 링크가 또 있어 모바일에서 중복
          노출됐다. 안내 아코디언에서 그 3개를 뺐으니(위 Footer.tsx), 이제
          이 영역 하나가 데스크톱/모바일 공통 "정책 링크 영역"이 되도록
          md:hidden을 없앴다 -- 새 영역을 만들지 않고 기존 구조를
          재사용한다는 요구에 따른 것. */}
      <nav className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {legalLinks.map((link) => <Link key={link.href} href={link.href} className={LINK_CLASS}>{link.label}</Link>)}
      </nav>
    </>
  );
}
