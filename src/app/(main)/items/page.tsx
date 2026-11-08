import { Select } from "@/components/ui/Select";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireReadyUser } from "@/lib/auth/session";
import { officerScope } from "@/lib/institution/service";
import { canAny } from "@/lib/permissions/check";
import { ITEM_PERMISSION_KEYS, PERMISSION_INFO } from "@/lib/permissions/definitions";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { readCustody, MANAGEMENT_ACTION_LABELS } from "@/lib/posts/custodySchema";
import { kstDay } from "@/lib/metrics/record";
import { addDays } from "@/lib/metrics/daySelection";

export default async function ItemManagementPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; place?: string; sort?: string; org?: string; page?: string }> }) {
  const user = await requireReadyUser("write", "/items");
  const scope = await officerScope(user.id);
  if (!scope) {
    // No item permission -> the page does not exist for this account. A permission without a 담당 기관 gets an explanation, not data.
    if (!canAny(user, ITEM_PERMISSION_KEYS)) notFound();
    return <div className="space-y-3"><h1 className="text-xl font-semibold">물품 관리</h1><p className="rounded-card border border-border p-6 text-sm text-muted-foreground">물품 관리 권한은 있지만 담당 기관이 지정되지 않아 물품을 처리할 수 없습니다. 전체 관리자에게 담당 기관 지정을 요청해주세요.</p></div>;
  }
  const p = await searchParams;
  const view = ["stored", "completed", "incoming", "candidates", "transferring"].includes(p.view ?? "") ? p.view! : "stored";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(p.page)) || 1));
  const org = scope.platform ? /^\d+$/.test(p.org ?? "") ? Number(p.org) : null : scope.organizationId;
  const owned = org ? Prisma.sql`p.custody_organization_id = ${org}` : Prisma.sql`p.custody_organization_id IS NOT NULL`;
  const condition = Prisma.sql`p.removed_at IS NULL AND p.temp_hidden_at IS NULL
    AND ${view === "candidates" ? Prisma.sql`p.custody_organization_id IS NULL` : view === "incoming" ? org ? Prisma.sql`p.pending_transfer_organization_id = ${org}` : Prisma.sql`p.pending_transfer_organization_id IS NOT NULL` : owned}
    AND p.status::text = ${view === "completed" ? "완료" : "보관 중"}
    ${view === "transferring" ? Prisma.sql`AND p.pending_transfer_organization_id IS NOT NULL` : Prisma.empty}
    ${p.q ? Prisma.sql`AND (p.title ILIKE ${"%" + p.q.slice(0, 100) + "%"} OR p.description ILIKE ${"%" + p.q.slice(0, 100) + "%"})` : Prisma.empty}
    ${p.place ? Prisma.sql`AND p.custody->>'place' ILIKE ${"%" + p.place.slice(0, 200) + "%"}` : Prisma.empty}`;
  const since = new Date(`${addDays(kstDay(), -29)}T00:00:00+09:00`);
  const base = org ? { custodyOrganizationId: org } : { custodyOrganizationId: { not: null } };
  const [ids, stored, incoming, returned, activity, institutions] = await Promise.all([
    prisma.$queryRaw<{ id: number; total: bigint }[]>`SELECT p.id, count(*) OVER() AS total FROM "FoundPost" p WHERE ${condition}
      ORDER BY ${p.sort === "received" ? Prisma.sql`p.custody->>'confirmedAt' DESC NULLS LAST` : Prisma.sql`p.created_at DESC`}, p.id DESC LIMIT 20 OFFSET ${(page - 1) * 20}`,
    prisma.foundPost.count({ where: { ...base, status: "KEEPING", removedAt: null, tempHiddenAt: null } }),
    prisma.foundPost.count({ where: { ...(org ? { pendingTransferOrganizationId: org } : { pendingTransferOrganizationId: { not: null } }), status: "KEEPING", removedAt: null, tempHiddenAt: null } }),
    prisma.postStatusChange.count({ where: { action: "complete", postType: "found", ...(org && { organizationId: org }), createdAt: { gte: since } } }),
    prisma.postStatusChange.findMany({ where: { ...(org && { OR: [{ organizationId: org }, { targetOrganizationId: org }] }), organizationId: { not: null } }, orderBy: { id: "desc" }, take: 10, select: { id: true, postId: true, action: true, institution: true, createdAt: true, fromStatus: true, toStatus: true } }),
    scope.platform ? prisma.organization.findMany({ where: { managementCampus: { not: null } }, select: { id: true, name: true } }) : [],
  ]);
  const items = await prisma.foundPost.findMany({ where: { id: { in: ids.map((i) => i.id) } }, select: { id: true, title: true, custody: true, createdAt: true, custodyOrganization: { select: { name: true } }, pendingTransferOrganization: { select: { name: true } } } });
  items.sort((a, b) => ids.findIndex((r) => r.id === a.id) - ids.findIndex((r) => r.id === b.id));
  const total = Number(ids[0]?.total ?? 0);
  const href = (n: number) => `/items?${new URLSearchParams({ view, q: p.q ?? "", place: p.place ?? "", sort: p.sort ?? "created", org: p.org ?? "", page: String(n) })}`;
  const format = (d: string | Date) => new Date(d).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return <div className="space-y-5"><div><h1 className="text-xl font-semibold">물품 관리</h1><p className="text-sm text-muted-foreground">{scope.platform ? "전체 관리자 · 전체 기관" : `${scope.institution}${scope.facility ? ` · ${scope.facility}` : ""}`} · 실제 접수한 물품을 보관·인계·반환합니다. 가능한 작업: {scope.permissions.map((k) => PERMISSION_INFO[k].label).join(", ")}</p></div>
    <div className="grid grid-cols-3 gap-2">{[["보관 중", stored], ["수령 확인 대기", incoming], ["최근 30일 반환", returned]].map(([label, n]) => <div key={label} className="rounded-card border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><b className="text-xl">{n}</b></div>)}</div>
    <nav className="flex flex-wrap gap-2" aria-label="물품 구분">{[["stored", "접수·보관 물품"], ["completed", "반환 완료"], ["transferring", "인계 요청 중"], ["incoming", "인계 수령 대기"], ["candidates", "접수 전 공개 습득물"]].map(([v, label]) => <Link key={v} href={`/items?view=${v}${org ? `&org=${org}` : ""}`} aria-current={view === v ? "page" : undefined} className={`rounded-full border border-border px-3 py-2 text-sm ${view === v ? "bg-primary text-primary-foreground" : "bg-card"}`}>{label}</Link>)}</nav>
    {view === "candidates" && <p className="text-sm text-muted-foreground">공개 습득물 검색입니다. 실제 물품을 수령한 경우에만 게시글에서 접수 확인을 해주세요. 발견 캠퍼스와 수령 기관이 달라도 접수할 수 있습니다.</p>}
    <form className="flex flex-wrap gap-2"><input type="hidden" name="view" value={view} /><label className="min-w-36 flex-1 text-sm">키워드<input name="q" defaultValue={p.q} maxLength={100} className="block w-full rounded-lg border border-border p-2" /></label><label className="min-w-36 flex-1 text-sm">보관 장소<input name="place" defaultValue={p.place} maxLength={200} className="block w-full rounded-lg border border-border p-2" /></label><label className="text-sm">정렬<Select name="sort" defaultValue={p.sort ?? "created"} className="block rounded-lg border border-border bg-card p-2"><option value="created">등록일순</option><option value="received">접수일순</option></Select></label>{scope.platform && <label className="text-sm">기관<Select name="org" defaultValue={p.org ?? ""} className="block rounded-lg border border-border bg-card p-2"><option value="">전체 기관</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></label>}<button className="self-end rounded-lg bg-primary p-2 text-primary-foreground">조회</button></form>
    <ul className="space-y-3">{items.map((i) => { const c = readCustody(i.custody); return <li key={i.id} className="rounded-card border border-border bg-card p-4"><Link className="font-medium text-primary" href={`/post/${i.id}?type=found`}>{i.title}</Link><p className="mt-1 text-sm">{i.custodyOrganization?.name ?? "기관 접수 전"} · {c?.place || "보관 장소 미등록"}</p><p className="text-xs text-muted-foreground">{c?.confirmedAt ? `접수: ${format(c.confirmedAt)}` : "작성자 신고 · 기관 미확인"} · 등록: {format(i.createdAt)}</p>{i.pendingTransferOrganization && <p className="text-xs text-primary">{i.pendingTransferOrganization.name} 수령 확인 대기</p>}</li>; })}</ul>
    {!items.length && <p className="rounded-card border border-border p-6 text-sm text-muted-foreground">조회한 물품이 없습니다.</p>}
    <div className="flex gap-4 text-sm">{page > 1 && <Link href={href(page - 1)}>이전</Link>}<span>{page}페이지 · {total}건</span>{page * 20 < total && <Link href={href(page + 1)}>다음</Link>}</div>
    <details className="rounded-card border border-border p-4"><summary>최근 기관 처리 이력</summary><ul className="mt-3 space-y-2 text-sm">{activity.map((a) => <li key={a.id}><Link href={`/post/${a.postId}?type=found`} className="text-primary">물품 #{a.postId}</Link> · {a.institution} · {MANAGEMENT_ACTION_LABELS[a.action ?? ""] ?? "상태 변경"} · {a.fromStatus} → {a.toStatus} · {format(a.createdAt)}</li>)}</ul></details>
  </div>;
}
