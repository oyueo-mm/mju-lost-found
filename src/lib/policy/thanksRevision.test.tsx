import { execSync } from "node:child_process";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { createTranslator } from "@/lib/i18n/translate";
import { ko } from "@/lib/i18n/messages/ko";
import { ACCEPTED_PRIVACY_VERSIONS, CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/lib/auth/terms";
import { LATEST_PRIVACY_POLICY_REVISION } from "@/lib/policy/privacyPolicy";
import { TERMS_EFFECTIVE_DATE, TERMS_REVISIONS } from "@/lib/policy/termsRevisions";
import { POLICY_REVISION_NOTICE } from "@/lib/policy/revisionNotice";
import termsArchive from "@/lib/policy/archives/terms-450f78a.json";
import privacyArchive from "@/lib/policy/archives/97837f2.json";

vi.mock("@/lib/i18n/server", () => ({ getTranslator: vi.fn(async () => createTranslator("ko", ko)) }));
const TermsPage = (await import("@/app/(policy)/policy/terms/page")).default;
const TermsHistory = (await import("@/app/(policy)/policy/terms/history/page")).default;
const TermsArchivePage = (await import("@/app/(policy)/policy/terms/history/450f78a/page")).default;
const PrivacyPage = (await import("@/app/(policy)/policy/privacy/page")).default;
const PrivacyArchivePage = (await import("@/app/(policy)/policy/privacy/history/97837f2/page")).default;
const ChangesPage = (await import("@/app/(policy)/policy/changes/page")).default;

const blob = (commit: string, path: string) => execSync(`git rev-parse ${commit}:"${path}"`, { encoding: "utf8" }).trim();

describe("감사 후기 개정 (이용약관·개인정보처리방침)", () => {
  it("is a notice-only revision: no consent version moves, so nobody is sent back to a consent screen", () => {
    expect(TERMS_REVISIONS[0].consent).toBe("notice");
    expect(LATEST_PRIVACY_POLICY_REVISION.consent).toBe("notice");
    expect(CURRENT_TERMS_VERSION).toBe("2026-10-04");
    expect(CURRENT_PRIVACY_VERSION).toBe("2026-10-16");
    expect(ACCEPTED_PRIVACY_VERSIONS).toContain(CURRENT_PRIVACY_VERSION);
  });

  it("terms: the review clause and the service entry are in force, with 시행일 and history", () => {
    const html = renderToStaticMarkup(TermsPage());
    expect(html).toContain("반환 완료 후 감사 후기 작성·확인 및 프로필 공개");
    expect(html).toContain("감사 후기 작성은 선택사항이며, 반환 기록에 연결된 상대방에게만 보낼 수 있습니다");
    expect(html).toContain("다시 비공개로 바꿀 수 있습니다");
    expect(html).toContain(`시행일: ${TERMS_EFFECTIVE_DATE.slice(0, 4)}년`);
    expect(html).toContain('href="/policy/terms/history"');
    expect(html).not.toMatch(/별점|매너온도|평점/);
  });

  it("terms: the earlier text is kept as a sourced archive without the review clause", () => {
    expect(termsArchive.sourceBlob).toBe(blob(termsArchive.sourceCommit, "src/app/(policy)/policy/terms/page.tsx"));
    const page = renderToStaticMarkup(TermsArchivePage());
    expect(page).toContain(termsArchive.sectionsHtml);
    expect([...termsArchive.sectionsHtml.matchAll(/<section\b/g)]).toHaveLength(10);
    expect(termsArchive.sectionsHtml).not.toContain("감사 후기");
    const history = renderToStaticMarkup(TermsHistory());
    expect(history).toContain('href="/policy/terms/history/450f78a"');
    for (const r of TERMS_REVISIONS) expect(history).toContain(r.summary);
  });

  it("privacy policy: review items, purpose, public scope and withdrawal handling are in force", () => {
    const html = renderToStaticMarkup(PrivacyPage());
    expect(html).toContain("감사 후기(칭찬 태그·감사 메시지, 보낸 사람·받은 사람과 관련 게시글·반환 기록·채팅방의 연결");
    expect(html).toContain("받은 분이 선택한 경우에만 받은 분의 프로필에");
    expect(html).toContain("메시지 내용으로 보낸 사람이 짐작될 수");
    expect(html).toContain("채팅 사진과 받은 감사 후기도 삭제합니다");
    expect(html).toContain("보낸 감사 후기(칭찬 태그·감사 메시지)");
    // no invented automatic deletion period for reviews
    expect(html).not.toMatch(/감사 후기[^<]{0,40}(\d+일|\d+년)/);
  });

  it("privacy policy: the 2026-10-18 text is kept as a sourced archive without the review items", () => {
    expect(privacyArchive.sourceBlob).toBe(blob(privacyArchive.sourceCommit, "src/app/(policy)/policy/privacy/page.tsx"));
    expect(renderToStaticMarkup(PrivacyArchivePage())).toContain(privacyArchive.sectionsHtml);
    expect(privacyArchive.effectiveDate).toBe("2026-10-18");
    expect(privacyArchive.sectionsHtml).not.toContain("감사 후기");
    expect(privacyArchive.sectionsHtml).toContain("로그인·방문 기록");
  });

  it("the notice's page shows both changes, their dates, links, and says reading is not consent", async () => {
    const html = renderToStaticMarkup(await ChangesPage());
    expect(html).toContain(TERMS_REVISIONS[0].summary);
    expect(html).toContain(LATEST_PRIVACY_POLICY_REVISION.summary);
    for (const href of ["/policy/terms", "/policy/terms/history", "/policy/privacy", "/policy/privacy/history"]) expect(html).toContain(`href="${href}"`);
    expect(html).toContain(ko["policyChanges.note"]);
    expect(POLICY_REVISION_NOTICE.relatedId).toBe(Number(LATEST_PRIVACY_POLICY_REVISION.date.replaceAll("-", "")));
  });
});
