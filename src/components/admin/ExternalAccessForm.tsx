"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createExternalAccessAction } from "@/app/(main)/admin/external-access/actions";
import { Button } from "@/components/ui/Button";
import { EXTERNAL_ACCESS_CAMPUSES } from "@/lib/externalAccess/schema";

const INPUT_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

// Registers an approved external account (same direct-Server-Action
// pattern as CreateAnnouncementForm). The email is what the person signs
// in to Google with; the server lower-cases and validates it.
export function ExternalAccessForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [campus, setCampus] = useState<string>(EXTERNAL_ACCESS_CAMPUSES[0]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await createExternalAccessAction({ email, name, affiliation, campus });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setEmail("");
    setName("");
    setAffiliation("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">외부 관계자 승인 등록</h2>
      <p className="text-xs text-muted-foreground">
        명지대학교 계정이 없는 경비원·시설관리자·협력업체 담당자 등의 Google 계정 이메일을 등록하면, 그 계정으로 로그인해
        일반 이용자와 같은 기능을 쓸 수 있습니다. 관리자 권한은 주어지지 않습니다. 한 사람당 한 계정만 등록해주세요.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">Google 계정 이메일</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} disabled={pending} className={INPUT_CLASS} placeholder="name@gmail.com" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">이름 또는 설명</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} disabled={pending} className={INPUT_CLASS} placeholder="예: 홍길동" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">소속/역할</span>
          <input type="text" value={affiliation} onChange={(e) => setAffiliation(e.target.value)} required maxLength={100} disabled={pending} className={INPUT_CLASS} placeholder="예: 종합관 경비실" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-foreground">캠퍼스</span>
          <select value={campus} onChange={(e) => setCampus(e.target.value)} disabled={pending} className={INPUT_CLASS}>
            {EXTERNAL_ACCESS_CAMPUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="rounded-card border border-destructive/30 bg-destructive-muted px-3.5 py-2 text-sm text-destructive">{error}</p>
      )}
      <Button type="submit" size="sm" disabled={pending || !email.trim() || !name.trim() || !affiliation.trim()} className="self-start">
        {pending ? "등록 중..." : "승인 등록"}
      </Button>
    </form>
  );
}
