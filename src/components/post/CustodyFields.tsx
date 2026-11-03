"use client";

import { useState } from "react";
import { CUSTODY_PLACES, CUSTODY_STATES, type CustodyInput } from "@/lib/posts/custodySchema";
const field = "rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground";
export function CustodyFields({ value, onChange, disabled }: { value: CustodyInput; onChange: (v: CustodyInput) => void; disabled?: boolean }) {
  const [reportedKeeping, setReportedKeeping] = useState(false);
  const keeping = value.state === "SELF" || value.state === "PLANNED" || (value.state === "REPORTED" && reportedKeeping);
  return <fieldset disabled={disabled} className="flex flex-col gap-3 rounded-lg border border-border p-4">
    <legend className="px-1 text-sm font-medium">습득물 보관 정보</legend>
    <label className="flex flex-col gap-1.5 text-sm">현재 습득물을 보관 중인가요?
      <select className={field} value={keeping ? "yes" : "no"} onChange={(e) => { setReportedKeeping(e.target.value === "yes"); onChange({ state: e.target.value === "yes" ? "SELF" : "UNKNOWN", place: "" }); }}>
        <option value="yes">네</option><option value="no">아니요</option>
      </select>
    </label>
    <label className="flex flex-col gap-1.5 text-sm">{keeping ? "어디에 보관 중인가요?" : "현재 물품은 어디에 있나요?"}
      <select className={field} value={value.state} onChange={(e) => onChange({ state: e.target.value as CustodyInput["state"], place: "" })}>
        {(keeping ? ["SELF", "PLANNED", "REPORTED"] as const : ["REPORTED", "UNKNOWN", "UNHELD"] as const).map((s) => <option key={s} value={s}>{s === "REPORTED" && keeping ? "기관 보관으로 신고" : CUSTODY_STATES[s]}</option>)}
      </select>
    </label>
    {(value.state === "PLANNED" || value.state === "REPORTED") && <>
      <label className="flex flex-col gap-1.5 text-sm">{value.state === "PLANNED" ? "전달할 장소" : "전달한 장소"}
        <input className={field} list="custody-places" maxLength={200} required value={value.place} onChange={(e) => onChange({ ...value, place: e.target.value })} placeholder="예: 국제관 1층 경비실" />
      </label>
      <datalist id="custody-places">{CUSTODY_PLACES.map((p) => <option key={p} value={p} />)}</datalist>
      <p className="text-xs text-muted-foreground">기관의 실제 접수 여부는 담당자가 확인한 뒤 표시됩니다.</p>
    </>}
    {(value.state === "SELF" || value.state === "PLANNED") && <p className="text-xs text-muted-foreground">다른 학생이 쉽게 찾을 수 있도록 가까운 교내 경비실 등 관리 기관에 맡기는 것을 권장합니다. 방문 전 수령 가능 여부를 확인해주세요. 개인 보관 위치는 공개하지 않아도 됩니다.</p>}
  </fieldset>;
}
