type Filter = { role?: string; organizationId?: number; campus?: string; actor?: number };
export function AdminRoleFilters({ filter, from, to, institutions, accounts }: { filter: Filter; from: string; to: string; institutions: { id: number; name: string; managementCampus: string | null }[]; accounts: { id: number; nickname: string | null }[] }) {
  const select = "block w-full min-w-0 max-w-full rounded-lg border border-border bg-card p-2 text-sm";
  return <form className="flex flex-wrap items-end gap-3 rounded-card border border-border p-4" aria-label="관리자 통계 필터">
    <input type="hidden" name="tab" value="admins" /><input type="hidden" name="period" value="custom" /><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} />
    <label className="text-sm">관리 권한 유형<select className={select} name="ar" defaultValue={filter.role ?? ""}><option value="">전체 관리자</option><option value="service">전체 관리자(모든 권한)</option><option value="officer">세부 권한 보유자</option></select></label>
    <label className="text-sm">캠퍼스<select className={select} name="ac" defaultValue={filter.campus ?? ""}><option value="">전체 캠퍼스</option>{["인문캠퍼스", "자연캠퍼스", "양쪽"].map((c) => <option key={c}>{c}</option>)}</select></label>
    <label className="text-sm">담당 기관<select className={select} name="ao" defaultValue={filter.organizationId ?? ""}><option value="">전체 기관</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.managementCampus} · {i.name}</option>)}</select></label>
    <label className="text-sm">계정<select className={select} name="aa" defaultValue={filter.actor ?? ""}><option value="">전체 계정</option>{accounts.map((u) => <option key={u.id} value={u.id}>{u.nickname ?? `계정 #${u.id}`}</option>)}</select></label><button className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">적용</button>
  </form>;
}
