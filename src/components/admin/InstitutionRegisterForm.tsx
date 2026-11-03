"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveInstitutionAction } from "@/app/(main)/admin/users/permissionActions";
import { Button } from "@/components/ui/Button";

// 기관 관리: register an agency (or mark an existing group) as a place that
// holds found items. Separate from granting anyone item permissions.
export function InstitutionRegisterForm({ organizations }: { organizations: { id: number; name: string }[] }) {
  const router = useRouter();
  const [message, setMessage] = useState(""); const [pending, setPending] = useState(false);
  const field = "w-full rounded-lg border border-border bg-card p-2 text-sm";
  return (
    <details className="rounded-card border border-border bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">물품 보관 기관 등록</summary>
      <form className="flex flex-col gap-3 border-t border-border p-4" onSubmit={async (e) => {
        e.preventDefault(); const data = new FormData(e.currentTarget); if (pending) return; setPending(true);
        try {
          const result = await saveInstitutionAction({ name: data.get("name"), campus: data.get("campus"), type: data.get("type"), ...(data.get("existing") && { organizationId: Number(data.get("existing")) }) });
          setMessage("error" in result ? result.error ?? "" : "관리 기관을 저장했습니다."); router.refresh();
        } catch { setMessage("저장하지 못했습니다. 다시 시도해주세요."); } finally { setPending(false); }
      }}>
        <label className="text-sm">기존 단체 사용 (선택)<select name="existing" className={field}><option value="">새 관리 기관 등록</option>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="text-sm">기관명<input name="name" required maxLength={100} className={field} placeholder="예: 본관 경비실" /></label>
        <label className="text-sm">기관 유형<input name="type" required maxLength={100} className={field} placeholder="예: 경비실" /></label>
        <label className="text-sm">캠퍼스<select name="campus" className={field}>{["인문캠퍼스", "자연캠퍼스", "양쪽"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <Button size="sm" disabled={pending} className="self-start">관리 기관 저장</Button>
        <p role="status" className="text-xs">{message}</p>
      </form>
    </details>
  );
}
