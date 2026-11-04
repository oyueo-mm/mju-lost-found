import Link from "next/link";

import { TERMS_REVISIONS } from "@/lib/policy/termsRevisions";

const REVISION_NOTE = { notice: "변경 안내로 시행", reconsent: "기존 회원 재동의" } as const;

// 이전 이용약관 및 변경 내역: one row per revision, and the full text that
// was in force before the latest revision behind a link (an archive rendered
// from its Git source, like the privacy policy's history).
export default function TermsHistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 text-sm leading-relaxed">
      <div className="space-y-2">
        <Link href="/policy/terms" className="font-medium text-primary hover:opacity-80">현재 이용약관</Link>
        <h1 className="text-xl font-semibold text-foreground">이전 이용약관 및 변경 내역</h1>
      </div>

      <div id="changes" className="scroll-mt-24 overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-left text-muted-foreground">
          <caption className="sr-only">시행일별 주요 변경사항</caption>
          <thead className="border-b border-border text-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">시행일</th>
              <th scope="col" className="px-4 py-3 font-medium">주요 변경사항</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {TERMS_REVISIONS.map((revision) => (
              <tr key={`${revision.date}:${revision.summary}`}>
                <th scope="row" className="whitespace-nowrap px-4 py-3 align-top font-normal">
                  <time dateTime={revision.date}>{revision.date}</time>
                </th>
                <td className="px-4 py-3 align-top">
                  {revision.summary} <span className="text-xs">({REVISION_NOTE[revision.consent]})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 text-muted-foreground">
        <Link href="/policy/terms/history/450f78a" className="inline-block font-medium text-primary hover:opacity-80">
          감사 후기 조항 추가 전 이용약관 전문 보기
        </Link>
        <p className="text-xs">감사 후기 조항을 추가한 개정 직전까지 적용된 이용약관의 보관본입니다.</p>
      </div>
    </div>
  );
}
