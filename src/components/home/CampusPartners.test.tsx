import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";
import { HEADER_SITE_NAME, KOREAN_SITE_NAME } from "@/lib/brand";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));

const { CampusPartners } = await import("./CampusPartners");
const html = renderToStaticMarkup(await CampusPartners());

describe("교내 협력 안내", () => {
  it("states only the cooperation, in one short line, linked to the existing 운영정책", () => {
    expect(ko["home.partners.body"]).toBe("학생지원팀·교목팀·교내 경비실과 협력하는 분실물 서비스");
    expect(html).toContain(ko["home.partners.body"]);
    expect(html).toContain('href="/policy/community"');
  });

  it("claims no official operation/designation and shows no partner logo or image", () => {
    expect(html).not.toMatch(/공식|지정|운영하는|직영|인증/);
    expect(html).not.toMatch(/<img|<svg|background-image/);
    // the footer still says this is a student-run, non-official service
    expect(ko["footer.disclaimer"]).toContain("공식 서비스가 아닌");
  });
});

describe("서비스 표기", () => {
  it("uses the short name only in the header; every other surface keeps the full name", () => {
    expect(HEADER_SITE_NAME).toBe("분실물 센터");
    expect(KOREAN_SITE_NAME).toBe("명지대학교 분실물 센터");
    expect(ko["brand.name"]).toBe(KOREAN_SITE_NAME);
    expect(KOREAN_SITE_NAME.endsWith(HEADER_SITE_NAME)).toBe(true);
  });
});
