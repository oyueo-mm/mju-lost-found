import Link from "next/link";

import { formatEffectiveDate } from "@/lib/auth/terms";
import { LATEST_PRIVACY_POLICY_REVISION, PRIVACY_POLICY_REVISIONS } from "@/lib/policy/privacyPolicy";

const REVISION_NOTE = { notice: "변경 안내로 시행", reconsent: "기존 회원 재동의" } as const;

export default function PrivacyPolicyHistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 text-sm leading-relaxed">
      <div className="space-y-2">
        <Link href="/policy/privacy" className="font-medium text-primary hover:opacity-80">현재 개인정보처리방침</Link>
        <h1 className="text-xl font-semibold text-foreground">이전 개인정보처리방침 및 변경 내역</h1>
      </div>
      <section className="space-y-3 rounded-card border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">이전 처리방침과 주요 변경사항 비교</h2>
        <p className="text-muted-foreground">개인정보 처리 정책은 유지하고, 문서의 구성과 표현을 간소화했습니다.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-muted-foreground">
            <caption className="sr-only">간소화 전 보관본과 현재 문서 비교</caption>
            <thead className="border-b border-border text-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">항목</th>
                <th scope="col" className="px-2 py-2 font-medium">간소화 전</th>
                <th scope="col" className="py-2 pl-2 font-medium">현재</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[
                ["전체 구성", "11개 조항", "7개 섹션"],
                ["수집 항목·자동 수집", "기능·구현 과정별 설명", "항목·목적·기간 중심으로 요약"],
                ["보관·삭제", "여러 조항에 나누어 설명", "한 섹션과 표로 통합"],
                ["개정 이력", "본문에 함께 표시", "별도 페이지에서 확인"],
              ].map(([item, before, after]) => (
                <tr key={item}>
                  <th scope="row" className="py-3 pr-3 align-top font-normal">{item}</th>
                  <td className="px-2 py-3 align-top">{before}</td>
                  <td className="py-3 pl-2 align-top">{after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/policy/privacy/history/b46ba45" className="inline-block font-medium text-primary hover:opacity-80">
          간소화 전 개인정보처리방침 원문 보기
        </Link>
        <p className="text-xs text-muted-foreground">
          개발 기록 b46ba45에 남아 있는 2026년 10월 16일 시행 문서의 보관본입니다.
          각 개정 당시 원문이나 실제 배포 여부를 이 보관본으로 대신 확인할 수는 없습니다.
        </p>
      </section>
      <section id="changes" className="scroll-mt-24 space-y-4 rounded-card border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">개정 이력</h2>
        <p className="text-muted-foreground">
          {LATEST_PRIVACY_POLICY_REVISION.consent === "notice"
            ? "최근 개정은 변경 안내로 시행하며, 기존 회원에게 별도의 재동의를 요청하지 않습니다."
            : "최근 개정은 기존 회원의 재동의가 필요합니다."}
        </p>
        <ol className="divide-y divide-border text-muted-foreground">
          {PRIVACY_POLICY_REVISIONS.map((revision) => (
            <li key={`${revision.date}:${revision.summary}`} className="space-y-1 py-3 first:pt-0 last:pb-0">
              <p className="font-medium text-foreground">
                <time dateTime={revision.date}>{formatEffectiveDate(revision.date)}</time>
                <span className="ml-2 text-xs font-normal text-muted-foreground">{REVISION_NOTE[revision.consent]}</span>
              </p>
              <p>{revision.summary}</p>
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">위 비교는 문서 간소화 전후를 설명하며, 기존 개정별 변경사항은 이력에 기록된 요약으로 확인할 수 있습니다.</p>
      </section>
    </div>
  );
}
