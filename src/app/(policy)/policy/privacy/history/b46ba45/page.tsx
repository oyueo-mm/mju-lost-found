import Link from "next/link";

import archive from "@/lib/policy/archives/b46ba45.json";

export default function ArchivedPrivacyPolicyPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="space-y-2 text-sm leading-relaxed">
        <Link href="/policy/privacy/history" className="font-medium text-primary hover:opacity-80">이전 개인정보처리방침 및 변경 내역</Link>
        <h1 className="text-xl font-semibold text-foreground">간소화 전 개인정보처리방침</h1>
        <p className="text-muted-foreground">
          개발 기록 {archive.sourceCommit.slice(0, 7)}의 원문 보관본입니다. 현재 적용되는 내용은{" "}
          <Link href="/policy/privacy" className="font-medium text-primary hover:opacity-80">현재 개인정보처리방침</Link>에서 확인해주세요.
        </p>
      </div>
      {/* Git 원문에서 생성해 저장한 고정 HTML입니다. 이용자 입력이나 외부 HTML을 받지 않습니다. */}
      <div className="flex flex-col gap-5 rounded-card border border-border bg-card p-5 text-sm leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: archive.sectionsHtml }} />
    </div>
  );
}
