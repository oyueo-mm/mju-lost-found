"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  reactivateExternalAccessAction,
  revokeExternalAccessAction,
  updateExternalAccessAction,
} from "@/app/(main)/admin/external-access/actions";
import { Button } from "@/components/ui/Button";
import { EXTERNAL_ACCESS_CAMPUSES } from "@/lib/externalAccess/schema";

export type ExternalAccessRowData = {
  id: number;
  email: string;
  name: string;
  affiliation: string;
  campus: string;
  status: "ACTIVE" | "REVOKED";
  createdAtLabel: string;
  createdByNickname: string | null;
  revokedAtLabel: string | null;
  revokedByNickname: string | null;
  account: { publicId: string; nickname: string | null } | null;
};

const INPUT_CLASS = "rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground disabled:opacity-60";

export function ExternalAccessRow({ grant }: { grant: ExternalAccessRowData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(grant.name);
  const [affiliation, setAffiliation] = useState(grant.affiliation);
  const [campus, setCampus] = useState(grant.campus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = grant.status === "ACTIVE";

  async function run(action: () => Promise<{ error: string } | { ok: true }>, confirmText?: string) {
    if (pending) return;
    if (confirmText && !window.confirm(confirmText)) return;
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3 text-sm last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-foreground">{grant.email}</span>
          <span className="text-muted-foreground">
            {grant.name} · {grant.affiliation} · {grant.campus}
          </span>
          <span className="text-xs text-muted-foreground">
            {grant.createdAtLabel} 등록({grant.createdByNickname ?? "알 수 없음"})
            {grant.revokedAtLabel && ` · ${grant.revokedAtLabel} 승인 취소(${grant.revokedByNickname ?? "알 수 없음"})`}
            {" · "}
            {grant.account ? (
              <Link href={`/profile/${grant.account.publicId}`} className="text-primary hover:underline">
                연결된 계정: {grant.account.nickname ?? "닉네임 미설정"}
              </Link>
            ) : (
              "아직 로그인한 적 없음"
            )}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            active ? "bg-primary-muted text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {active ? "승인됨" : "승인 취소됨"}
        </span>
      </div>

      {editing && (
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="이름 또는 설명" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} disabled={pending} className={INPUT_CLASS} />
          <input aria-label="소속/역할" value={affiliation} onChange={(e) => setAffiliation(e.target.value)} maxLength={100} disabled={pending} className={INPUT_CLASS} />
          <select aria-label="캠퍼스" value={campus} onChange={(e) => setCampus(e.target.value)} disabled={pending} className={INPUT_CLASS}>
            {EXTERNAL_ACCESS_CAMPUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button type="button" size="sm" disabled={pending} onClick={() => run(() => updateExternalAccessAction(grant.id, { name, affiliation, campus }))}>
              저장
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
              취소
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(true)}>
            정보 수정
          </Button>
        )}
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(
                () => revokeExternalAccessAction(grant.id),
                `${grant.email}의 승인을 취소할까요? 이 계정은 즉시 서비스를 이용할 수 없게 됩니다.`,
              )
            }
          >
            승인 취소
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => reactivateExternalAccessAction(grant.id))}>
            다시 승인
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
