import Link from "next/link";

import archive from "@/lib/policy/archives/5abb77e.json";

// The policy in force from the second 2026-10-17 revision (관리자 운영 작업
// 기록) until the revision that added admins' sign-ins and visits: its seven
// sections rendered from the Git source of that release (5abb77e).
export default function ArchivedPrivacyPolicy20261017bPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2 text-sm leading-relaxed">
        <Link href="/policy/privacy/history" className="font-medium text-primary hover:opacity-80">이전 개인정보처리방침 및 변경 내역</Link>
        <h1 className="text-xl font-semibold text-foreground">2026-10-17 시행 개인정보처리방침(관리자 로그인·방문 기록 안내 추가 전)</h1>
        <p className="text-muted-foreground">
          {archive.effectiveDate}부터 관리자 로그인·방문 기록 안내를 추가한 개정 전까지 적용된 내용의 보관본입니다(개발 기록 {archive.sourceCommit.slice(0, 7)}).
          현재 적용되는 내용은{" "}
          <Link href="/policy/privacy" className="font-medium text-primary hover:opacity-80">현재 개인정보처리방침</Link>에서 확인해주세요.
        </p>
      </div>
      {/* Git 원문에서 생성해 저장한 고정 HTML입니다. 이용자 입력이나 외부 HTML을 받지 않습니다. */}
      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 text-sm leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: archive.sectionsHtml }} />
    </div>
  );
}
