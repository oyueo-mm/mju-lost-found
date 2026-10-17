import Link from "next/link";

import { formatEffectiveDate } from "@/lib/auth/terms";
import { PRIVACY_POLICY_REVISIONS } from "@/lib/policy/privacyPolicy";

const REVISION_NOTE = { notice: "변경 안내로 시행", reconsent: "기존 회원 재동의" } as const;

export default function PrivacyPolicyHistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 text-sm leading-relaxed">
      <div className="space-y-2">
        <Link href="/policy/privacy" className="font-medium text-primary hover:opacity-80">현재 개인정보처리방침</Link>
        <h1 className="text-xl font-semibold text-foreground">이전 개인정보처리방침 및 변경 내역</h1>
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
            {PRIVACY_POLICY_REVISIONS.map((revision) => (
              <tr key={`${revision.date}:${revision.summary}`}>
                <th scope="row" className="whitespace-nowrap px-4 py-3 align-top font-normal">
                  <time dateTime={revision.date}>{revision.date}</time>
                </th>
                <td className="px-4 py-3 align-top">{revision.history?.summary ?? revision.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="rounded-card border border-border bg-card p-4">
        <summary className="cursor-pointer font-medium text-foreground">변경 전후 및 상세 내역</summary>
        <p className="mt-3 text-xs text-muted-foreground">당시 처리방침의 안내 내용을 기준으로 비교했습니다.</p>
        <ol className="mt-3 divide-y divide-border text-muted-foreground">
          {PRIVACY_POLICY_REVISIONS.map((revision) => (
            <li key={`${revision.date}:${revision.summary}`} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <p className="font-medium text-foreground">
                {formatEffectiveDate(revision.date)} · {REVISION_NOTE[revision.consent]}
              </p>
              {revision.history && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="font-medium">변경 전</dt><dd>{revision.history.before}</dd>
                  <dt className="font-medium">변경 후</dt><dd>{revision.history.after}</dd>
                </dl>
              )}
              <p>{revision.summary}</p>
            </li>
          ))}
        </ol>
      </details>

      <div className="space-y-2 text-muted-foreground">
        <Link href="/policy/privacy/history/5abb77e" className="inline-block font-medium text-primary hover:opacity-80">
          2026-10-17 시행 개인정보처리방침(관리자 로그인·방문 기록 안내 추가 전) 전문 보기
        </Link>
        <p className="text-xs">관리자 로그인·방문 기록 안내를 추가한 개정 직전까지 적용된 처리방침의 보관본입니다.</p>
        <Link href="/policy/privacy/history/634900f" className="inline-block font-medium text-primary hover:opacity-80">
          2026-10-17 시행 개인정보처리방침(관리자 활동 기록 안내 추가 전) 전문 보기
        </Link>
        <p className="text-xs">관리자 운영 작업 기록 안내를 추가한 같은 날 개정 직전까지 적용된 처리방침의 보관본입니다.</p>
        <Link href="/policy/privacy/history/f21e596" className="inline-block font-medium text-primary hover:opacity-80">
          2026-10-16 시행 개인정보처리방침 전문 보기
        </Link>
        <p className="text-xs">2026-10-17 개정 직전까지 적용된 처리방침의 보관본입니다.</p>
        <p className="text-xs">문서 간소화는 구성·표현만 정리한 것으로, 개인정보 처리 정책은 동일합니다.</p>
        <Link href="/policy/privacy/history/b46ba45" className="inline-block font-medium text-primary hover:opacity-80">
          간소화 전 개인정보처리방침 전문 보기
        </Link>
        <p className="text-xs">2026-10-16 시행 문서의 간소화 전 보관본입니다. 개정별 전문을 대신하지 않습니다.</p>
      </div>
    </div>
  );
}
