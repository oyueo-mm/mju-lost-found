import Link from "next/link";

import archive from "@/lib/policy/archives/terms-450f78a.json";

// The terms in force before the 감사 후기 revision: their ten sections
// rendered from the Git source of that version (450f78a). The consent
// version they were agreed under is 2026-10-04.
export default function ArchivedTermsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2 text-sm leading-relaxed">
        <Link href="/policy/terms/history" className="font-medium text-primary hover:opacity-80">이전 이용약관 및 변경 내역</Link>
        <h1 className="text-xl font-semibold text-foreground">감사 후기 조항 추가 전 이용약관</h1>
        <p className="text-muted-foreground">
          {archive.effectiveDate} 시행 이후 감사 후기 조항 추가 전까지 적용된 내용의 보관본입니다(개발 기록 {archive.sourceCommit.slice(0, 7)}). 현재
          적용되는 내용은{" "}
          <Link href="/policy/terms" className="font-medium text-primary hover:opacity-80">현재 이용약관</Link>에서 확인해주세요.
        </p>
      </div>
      {/* Git 원문에서 생성해 저장한 고정 HTML입니다. 이용자 입력이나 외부 HTML을 받지 않습니다. */}
      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 text-sm text-foreground" dangerouslySetInnerHTML={{ __html: archive.sectionsHtml }} />
    </div>
  );
}
