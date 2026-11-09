"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { Select } from "@/components/ui/Select";
import { QR_REGISTRY } from "@/lib/metrics/qrRegistry";
import { POSTER_CAMPAIGN } from "@/lib/metrics/utmStandard.mjs";
import { buildUtmLink, qrFileName, UTM_LINK_PAGES, type UtmLinkInput } from "@/lib/metrics/utmLink";
import { EMPTY_QR_SELECTION } from "@/lib/metrics/qrSelection";
import { RegisteredQrPicker } from "./RegisteredQrPicker";
import { QrResult } from "./QrResult";

const PRESETS = [
  { label: "에브리타임", source: "everytime", medium: "community" },
  { label: "인스타그램", source: "instagram", medium: "social" },
  { label: "카카오톡", source: "kakao", medium: "messenger" },
  { label: "포스터 QR", source: "poster_qr", medium: "offline" },
] as const;
const field = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground";
const LABEL = { path: "연결 화면", source: "Source", medium: "Medium", campaign: "Campaign", content: "Content", registry: "등록부" } as const;

function DirectUtmBuilder({ input, setInput }: { input: UtmLinkInput; setInput: Dispatch<SetStateAction<UtmLinkInput>> }) {
  const { path, source, medium, campaign, content = "" } = input;
  const update = (key: keyof UtmLinkInput, value: string) => setInput((previous) => ({ ...previous, [key]: value }));
  const result = buildUtmLink({ path, source, medium, campaign, content });
  return <section className="flex flex-col gap-4" aria-label="직접 UTM 생성">
    <p className="text-sm text-muted-foreground">새 홍보 링크를 직접 입력합니다. 등록부에 자동 등록되거나 승인되지 않습니다.</p>
    <div className="flex flex-wrap gap-2" role="group" aria-label="자주 쓰는 출처">{PRESETS.map((preset) => <button type="button" key={preset.source} onClick={() => {
      setInput((previous) => ({ ...previous, source: preset.source, medium: preset.medium, ...(preset.source === "poster_qr" ? { campaign: POSTER_CAMPAIGN } : {}) }));
    }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${source === preset.source ? "border-primary bg-primary-muted text-primary" : "border-border text-muted-foreground"}`}>{preset.label}</button>)}</div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">연결 화면<Select aria-label="연결 화면" className={field} value={path} onChange={(e) => update("path", e.target.value)}>{UTM_LINK_PAGES.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</Select></label>
      {([['출처 Source (필수)', 'source'], ['매체 Medium (선택)', 'medium'], ['캠페인 Campaign (선택)', 'campaign'], ['설치 위치·용도 Content (선택)', 'content']] as const).map(([label, key]) => <label key={key} className="flex flex-col gap-1 text-sm">{label}<input className={field} value={input[key] ?? ""} maxLength={32} onChange={(e) => update(key, e.target.value)} /></label>)}
    </div>
    <p className="text-xs text-muted-foreground">영문 소문자·숫자·_·- 32자 이내. 개인정보를 넣지 마세요. 미등록 Content·조합은 상세 통계에서 묶입니다.</p>
    {!result.ok ? <p role="alert" className="text-sm text-destructive">{result.invalid.includes("registry") ? "포스터 QR의 Campaign·Content·목적지는 승인된 등록부와 일치해야 합니다. 등록된 QR 선택 화면을 이용해 주세요." : `${result.invalid.map((k) => LABEL[k]).join(", ")}: 입력값을 확인해 주세요. 숫자 7자리 이상 연속 값은 사용할 수 없습니다.`}</p> : <>
      <p role="status" className="text-xs text-muted-foreground">{QR_REGISTRY.some((e) => e.url === result.link) ? "입력 URL이 기존 등록부와 일치합니다. 등록부는 변경하지 않습니다." : "직접 생성 링크 · 등록부 미등록"}</p>
      <div className="mx-auto w-full max-w-lg rounded-card border border-border p-4">
        <QrResult key={result.link} url={result.link} pngName={qrFileName(result.source, result.campaign, "png", result.content)} svgName={qrFileName(result.source, result.campaign, "svg", result.content)} />
      </div>
    </>}
  </section>;
}

export function UtmLinkBuilder({ month }: { month: string }) {
  const [mode, setMode] = useState<"registered" | "direct">("registered");
  const [selection, setSelection] = useState(EMPTY_QR_SELECTION);
  const [input, setInput] = useState<UtmLinkInput>({ path: "/", source: "everytime", medium: "community", campaign: "", content: "" });
  return <div className="flex flex-col gap-5">
    <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted/50 p-1" role="group" aria-label="QR 작업 선택">
      {([['registered', '등록된 QR 선택'], ['direct', '직접 UTM 생성']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${mode === value ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
    </div>
    {mode === "registered" ? <RegisteredQrPicker month={month} value={selection} onChange={setSelection} /> : <DirectUtmBuilder input={input} setInput={setInput} />}
  </div>;
}
