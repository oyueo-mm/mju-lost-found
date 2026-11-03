"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { PostType } from "@/lib/posts/schema";

type Props = { id: number; type: PostType; updatedAt: string; completed: boolean; confirmedCustody: boolean; platform: boolean; organizationId?: number | null; pendingOrganizationId?: number | null; scopeOrganizationId?: number | null; permissions?: string[]; institutions?: { id: number; name: string }[] };
export function PostManagement({ id, type, updatedAt, completed, confirmedCustody, platform, organizationId, pendingOrganizationId, scopeOrganizationId, permissions = [], institutions = [] }: Props) {
  const router = useRouter();
  const incoming = Boolean(pendingOrganizationId && pendingOrganizationId === scopeOrganizationId && organizationId !== scopeOrganizationId);
  // Only the actions this account holds the permission for are offered (the
  // server checks the same permission again on every request).
  const has = (key: string) => platform || permissions.includes(key);
  const own = platform || (organizationId != null && organizationId === scopeOrganizationId);
  const options: [string, string][] = [];
  if (incoming) { if (has("items.transfer")) options.push(["transfer_accept", "인계 물품 실제 수령 확인"]); }
  else {
    if (!completed && type === "found" && !confirmedCustody && has("items.receive")) options.push(["confirm", "실제 접수 확인"]);
    if (!completed && type === "found" && confirmedCustody && has("items.custody")) options.push(["location", "보관 장소 변경"]);
    if (!completed && !pendingOrganizationId && (confirmedCustody || platform) && has("items.return")) options.push(["complete", type === "found" ? "반환 완료" : "찾음 완료"]);
    if (!completed && type === "found" && confirmedCustody && !pendingOrganizationId && has("items.transfer")) options.push(["transfer_request", "다른 기관으로 인계 요청"]);
    if (!completed && pendingOrganizationId && has("items.transfer")) options.push(["transfer_cancel", "진행 중인 인계 취소"]);
    if (completed && has("items.restore") && own) options.push(["reopen", "완료 처리 복구"]);
    if (!completed && type === "found" && has("items.restore") && (platform || own)) options.push(["correct_institution", "사유를 기록하고 관리 기관 정정"]);
    if (!completed && confirmedCustody && has("items.restore") && (platform || own)) options.push(["release", "잘못된 접수 확인 해제"]);
  }
  const initial = options[0]?.[0] ?? "";
  const [action, setAction] = useState(initial), [place, setPlace] = useState(""), [target, setTarget] = useState(""), [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  if (!options.length) return null;
  const placeNeeded = ["confirm", "location", "transfer_accept", "correct_institution"].includes(action);
  const targetNeeded = action === "transfer_request" || action === "correct_institution" || action === "confirm" && platform;
  const reasonNeeded = ["reopen", "correct_institution", "release"].includes(action);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (pending) return; setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/posts/${id}?type=${type}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ management: { action, expectedUpdatedAt: updatedAt, confirmed, ...(placeNeeded && { place }), ...(targetNeeded && { organizationId: Number(target) }), ...(reason && { reason }) } }) });
      const result = await response.json(); setMessage(response.ok ? "처리 내용이 저장되었습니다." : result.error ?? "처리하지 못했습니다.");
      if (response.ok) { setConfirmed(false); router.refresh(); }
    } catch { setMessage("연결을 확인한 뒤 다시 시도해주세요."); } finally { setPending(false); }
  }
  const field = "rounded-lg border border-border bg-card p-2 w-full";
  return <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
    <h2 className="text-sm font-semibold">물품 접수·반환 관리</h2>
    {pendingOrganizationId && <p className="text-sm text-primary">{institutions.find((i) => i.id === pendingOrganizationId)?.name ?? "대상 기관"}의 수령 확인 대기 중입니다. 확인 전까지 기존 기관이 관리합니다.</p>}
    <label className="flex flex-col gap-1.5 text-sm">처리 내용<select className={field} value={action} onChange={(e) => { setAction(e.target.value); setConfirmed(false); }} disabled={pending}>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {targetNeeded && <label className="text-sm">대상 관리 기관<select required className={field} value={target} onChange={(e) => setTarget(e.target.value)}><option value="">기관 선택</option>{institutions.filter((i) => action !== "transfer_request" || i.id !== organizationId).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
    {placeNeeded && <label className="text-sm">실제 보관 장소<input className={field} required maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} disabled={pending} /></label>}
    <label className="text-sm">{reasonNeeded ? "정정·복구 사유 (필수)" : "처리 메모 (선택)"}<input className={field} required={reasonNeeded} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required disabled={pending} />{action === "transfer_request" ? "실물 인계를 요청합니다. 수령 기관의 확인 전까지 기존 기관이 관리함을 확인했습니다." : action === "complete" ? "실제 반환 또는 찾음을 확인했습니다." : reasonNeeded ? "변경 사유와 실제 물품 상태를 확인했습니다." : "소속 기관에서 실물을 실제 접수·보관 중임을 확인했습니다."}</label>
    <Button size="sm" disabled={pending || !confirmed} className="self-start">{pending ? "처리 중…" : "처리 저장"}</Button><p role="status" className="text-sm">{message}</p>
  </form>;
}
