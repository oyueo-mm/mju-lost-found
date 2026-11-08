"use client";

import { Select } from "@/components/ui/Select";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { savePermissionsAction } from "@/app/(main)/admin/users/permissionActions";
import { Button } from "@/components/ui/Button";
import {
  ITEM_PERMISSION_KEYS, PERMISSION_GROUPS, PERMISSION_INFO, PERMISSION_PRESETS, PERMISSION_REQUIRES,
  matchingPresetId, withRequiredPermissions, type GrantablePermissionKey, type PermissionKey,
} from "@/lib/permissions/definitions";

type Institution = { id: number; name: string; managementCampus: string | null };
type Props = {
  userId: number;
  label: string;
  current: GrantablePermissionKey[];
  organizationId: number | null;
  facility: string;
  institutions: Institution[];
  // Full administrators have every permission; their rights are not edited here.
  targetIsAdmin?: boolean;
  isSelf?: boolean;
  defaultOpen?: boolean;
};

const field = "w-full min-w-0 max-w-full rounded-lg border border-border bg-card px-3 py-2 text-sm";
const names = (keys: readonly PermissionKey[]) => keys.map((k) => PERMISSION_INFO[k].label);

// 관리 권한 설정: presets only pre-fill the checkboxes; nothing is saved until the
// reviewed change is confirmed. The server validates every part again.
export function AdminPermissionEditor({ userId, label, current, organizationId, facility, institutions, targetIsAdmin, isSelf, defaultOpen = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState<GrantablePermissionKey[]>(current);
  const [org, setOrg] = useState(organizationId ? String(organizationId) : "");
  const [place, setPlace] = useState(facility);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const next = useMemo(() => withRequiredPermissions(selected), [selected]);
  const added = next.filter((k) => !current.includes(k));
  const removed = current.filter((k) => !next.includes(k));
  const wantsItems = next.some((k) => ITEM_PERMISSION_KEYS.includes(k));
  const scopeChanged = wantsItems && (String(organizationId ?? "") !== org || facility !== place);
  const changed = added.length > 0 || removed.length > 0 || scopeChanged;
  const preset = matchingPresetId(next);
  const dependent = (key: GrantablePermissionKey) => Object.entries(PERMISSION_REQUIRES).some(([top, need]) => need === key && next.includes(top as GrantablePermissionKey));

  if (targetIsAdmin) return <p className="text-xs text-muted-foreground">전체 관리자는 모든 관리 권한을 가지고 있어 세부 권한을 따로 설정하지 않습니다. 지정·해제는 위의 관리자 지정 절차(승인 필요)를 이용하세요.</p>;
  if (isSelf) return <p className="text-xs text-muted-foreground">본인의 관리 권한은 직접 변경할 수 없습니다.</p>;

  function toggle(key: GrantablePermissionKey) {
    setConfirmed(false); setMessage(null);
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
  }
  function applyPreset(keys: GrantablePermissionKey[]) { setConfirmed(false); setMessage(null); setSelected(keys); }

  async function save(revokeAll = false) {
    if (pending) return;
    if (revokeAll && !confirm(`${label}님의 관리 권한을 모두 회수하시겠습니까?`)) return;
    setPending(true); setMessage(null);
    try {
      const result = await savePermissionsAction({
        userId, permissions: revokeAll ? [] : next,
        ...(wantsItems && !revokeAll ? { organizationId: org ? Number(org) : null, facility: place } : {}),
        ...(reason.trim() && { reason: reason.trim() }),
      });
      if ("error" in result) { setMessage({ kind: "error", text: result.error }); return; }
      const parts = [result.unchanged ? "변경된 내용이 없습니다." : "관리 권한을 저장했습니다. 다음 요청부터 바로 적용됩니다."];
      if (result.added.length) parts.push(`추가: ${result.added.join(", ")}`);
      if (result.removed.length) parts.push(`제거: ${result.removed.join(", ")}`);
      if (result.warning) parts.push(result.warning);
      setMessage({ kind: "ok", text: parts.join(" · ") });
      setConfirmed(false); setReason("");
      if (revokeAll) setSelected([]);
      router.refresh();
    } catch { setMessage({ kind: "error", text: "저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요." }); }
    finally { setPending(false); }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "관리 권한 설정 닫기" : "관리 권한 설정"}</Button>
        {current.length > 0 && <span className="text-xs text-muted-foreground">{names(current).join(" · ")}</span>}
      </div>
      {open && (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-3 rounded-card border border-border bg-background p-3 text-sm">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">권한 프리셋 (고른 뒤 아래에서 자유롭게 바꿀 수 있어요)</legend>
            <div className="flex flex-wrap gap-1.5">
              {PERMISSION_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => applyPreset(p.keys)} aria-pressed={preset === p.id}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${preset === p.id ? "border-primary bg-primary-muted text-primary" : "border-border text-muted-foreground"}`}>{p.label}</button>
              ))}
              <span aria-pressed={preset === "custom"} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${preset === "custom" ? "border-primary bg-primary-muted text-primary" : "border-border text-muted-foreground"}`}>직접 설정</span>
              <span className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground" title="전체 관리자는 위의 ‘관리자 지정’(승인제)으로만 지정합니다.">전체 관리자 · 별도 승인 절차</span>
            </div>
          </fieldset>

          {PERMISSION_GROUPS.map((g) => (
            <details key={g.id} open={g.keys.some((k) => k !== "permissions.manage" && next.includes(k as GrantablePermissionKey))} className="rounded-lg border border-border">
              <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium">{g.label} <span className="text-xs font-normal text-muted-foreground">({g.keys.filter((k) => next.includes(k as GrantablePermissionKey)).length}/{g.keys.length})</span></summary>
              <ul className="flex flex-col gap-1 border-t border-border px-3 py-2">
                {g.keys.map((k) => {
                  const locked = k === "permissions.manage";
                  const key = k as GrantablePermissionKey;
                  const forced = !locked && dependent(key);
                  return (
                    <li key={k}>
                      <label className={`flex items-start gap-2 ${locked ? "opacity-60" : ""}`}>
                        <input type="checkbox" className="mt-1" disabled={locked || forced || pending} checked={!locked && next.includes(key)} onChange={() => toggle(key)} />
                        <span><b className="font-medium">{PERMISSION_INFO[k].label}</b>{forced && <span className="text-xs text-muted-foreground"> (선택한 권한에 필요)</span>}{locked && <span className="text-xs text-muted-foreground"> (전체 관리자 전용 · 위임 불가)</span>}<br /><span className="text-xs text-muted-foreground">{PERMISSION_INFO[k].description}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}

          {wantsItems && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">물품 권한은 담당 기관의 물품에만 적용돼요. 기관을 정하지 않으면 물품을 처리할 수 없습니다.</p>
              <label className="flex flex-col gap-1">담당 기관
                <Select className={field} value={org} onChange={(e) => { setOrg(e.target.value); setConfirmed(false); }} required>
                  <option value="">기관 선택</option>
                  {institutions.map((i) => <option key={i.id} value={i.id}>{i.managementCampus} · {i.name}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1">담당 시설 (선택)
                <input className={field} maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 국제관 1층" />
              </label>
            </div>
          )}

          <div className="rounded-lg bg-muted p-3 text-xs leading-relaxed" aria-live="polite">
            <b className="text-foreground">변경 내용 확인</b>
            {!changed ? <p className="text-muted-foreground">변경 사항이 없습니다.</p> : (
              <>
                {added.length > 0 && <p>추가: {names(added).join(", ")}</p>}
                {removed.length > 0 && <p>제거: {names(removed).join(", ")}</p>}
                {scopeChanged && <p>담당 기관·시설이 바뀝니다.</p>}
              </>
            )}
            <p className="text-muted-foreground">변경 후: {next.length ? names(next).join(", ") : "관리 권한 없음 (일반 사용자)"}</p>
          </div>

          <label className="flex flex-col gap-1">변경 사유 (선택)
            <input className={field} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="flex items-start gap-2"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />위 변경 내용과 대상 계정({label})을 확인했습니다.</label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={pending || !confirmed || !changed}>{pending ? "저장 중..." : "변경사항 저장"}</Button>
            {current.length > 0 && <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void save(true)}>권한 전체 회수</Button>}
          </div>
          {message && <p role="status" className={`text-xs ${message.kind === "error" ? "text-destructive" : "text-primary"}`}>{message.text}</p>}
        </form>
      )}
    </div>
  );
}
