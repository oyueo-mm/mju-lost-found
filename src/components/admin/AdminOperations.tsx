import type { loadAdminOperations } from "@/lib/metrics/operations";

export function AdminOperations({ report, label, all }: { report: Awaited<ReturnType<typeof loadAdminOperations>>; label: string; all: boolean }) {
  const total = (metric: string) => report.daily.filter((r) => r.metric === metric).reduce((n, r) => n + r.n, 0);
  return <section id="admin-service" data-stats-section="관리자 서비스 이용" tabIndex={-1} className="space-y-4 rounded-card border border-border bg-card p-4">
    <h2 className="font-semibold">관리자 서비스 이용 · {label}</h2>
    <p className="text-xs text-muted-foreground">관리 권한을 하나라도 가진 계정(전체 관리자·세부 권한 보유자)의 활동입니다. 여러 권한을 가져도 한 번만 집계합니다. 세부 역할 수집 시작: {report.since ?? "미측정"}. 이전 관리 활동은 역할을 추정하지 않습니다. 계정별 방문·검색은 수집하지 않으며 담당자 선택 시 처리 실적과 등록만 표시합니다.</p>
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[...(!report.individualTrafficUnavailable ? [["페이지뷰", total("visit.internal.pv")], ["시작 세션", total("visit.internal.session")], ["검색", report.daily.filter((r) => r.metric.startsWith("search.")).reduce((a, r) => a + r.n, 0)], ["추천 표시", total("recommend.shown.internal")]] : []), ...report.creation.map((r) => [{ lost: "분실물 등록", found: "습득물 등록", signups: "가입", messages: "메시지" }[r.kind] ?? r.kind, r.n])].map(([name, n]) => <div key={name}><dt className="text-xs text-muted-foreground">{name}</dt><dd className="text-xl font-semibold">{Number(n).toLocaleString()}</dd></div>)}
    </dl>
    <h3 className="text-sm font-medium">물품 처리 실적 ({all ? "전체 담당자" : "본인"})</h3>
    <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">담당자</th><th>기관</th><th>처리</th><th>건수</th></tr></thead><tbody>{report.events.map((r, i) => <tr key={i}><td className="p-2">{r.nickname ?? "담당자"}</td><td>{r.institution ?? "개인 활동"}</td><td>{{ confirm: "접수 확인", location: "보관 장소 변경", complete: "찾음·반환 완료", reopen: "완료 복구", transfer_request: "기관 인계 요청", transfer_accept: "기관 인계 완료", transfer_cancel: "인계 취소", correct_institution: "관리 기관 정정", release: "접수 해제", owner_status: "본인 게시글 상태 변경", owner_custody: "본인 보관 정보 변경" }[r.action ?? ""] ?? "상태 변경"}</td><td>{r.n}</td></tr>)}</tbody></table></div>
    {report.events.length === 0 && <p className="text-xs text-muted-foreground">선택한 기간의 처리 기록이 없습니다.</p>}
  </section>;
}
