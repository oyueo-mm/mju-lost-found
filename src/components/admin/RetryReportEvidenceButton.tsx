"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryReportEvidenceButton({ reportId }: { reportId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <div className="text-xs text-muted-foreground">
    <p>원본이 남아 있으면 사본 만들기를 다시 시도할 수 있습니다. 원본이 이미 삭제된 경우에는 복구할 수 없습니다. 이전 신고에 재시도 정보가 없으면 다시 복사할 수 없습니다.</p>
    <button type="button" disabled={busy} className="mt-2 rounded border border-border px-3 py-2 disabled:opacity-50" onClick={async () => {
      setBusy(true);
      setMessage("");
      try {
        const result = await fetch(`/api/admin/reports/${reportId}/evidence/retry`, { method: "POST" });
        setMessage(result.ok ? "다시 시도했습니다. 사진 상태를 확인해 주세요." : "다시 시도하지 못했습니다. 처리 대기 상태와 권한을 확인해 주세요.");
        if (result.ok) router.refresh();
      } catch { setMessage("연결하지 못했습니다. 다시 시도해 주세요."); }
      finally { setBusy(false); }
    }}>{busy ? "시도 중…" : "사진 사본 다시 시도"}</button>
    <p role="status">{message}</p>
  </div>;
}
