"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Select } from "@/components/ui/Select";
import { QR_REGISTRY, type QrRegistryEntry } from "@/lib/metrics/qrRegistry";
import { ALL_PURPOSES, EMPTY_QR_SELECTION, purposeLabel, resolveQrSelection, type QrSelection } from "@/lib/metrics/qrSelection";
import { qrArchive, registeredQrFileName, saveQrBytes, type QrFormat } from "@/lib/metrics/qrDownloads";
import { UTM_LINK_PAGES } from "@/lib/metrics/utmLink";
import { QrResult, qrButton } from "./QrResult";

const field = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground disabled:opacity-50";

function PlaceDownloads({ entries, name }: { entries: readonly QrRegistryEntry[]; name: string }) {
  const active = useRef(false);
  const [busy, setBusy] = useState<QrFormat | null>(null);
  const [error, setError] = useState("");
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const download = async (format: QrFormat) => {
    if (busy) return;
    setBusy(format); setError("");
    try {
      const bytes = await qrArchive(entries, format);
      if (active.current) saveQrBytes(`${name}_${format}.zip`, bytes, "application/zip");
    } catch { if (active.current) setError("ZIP을 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { if (active.current) setBusy(null); }
  };
  return <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs text-muted-foreground">이 장소의 QR {entries.length}종 전체</span>
      <button type="button" className={qrButton} disabled={!!busy} onClick={() => download("png")}>{busy === "png" ? "PNG ZIP 준비 중…" : "PNG 일괄 다운로드 (ZIP)"}</button>
      <button type="button" className={qrButton} disabled={!!busy} onClick={() => download("svg")}>{busy === "svg" ? "SVG ZIP 준비 중…" : "SVG 일괄 다운로드 (ZIP)"}</button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

export function RegisteredQrPicker({ month, entries = QR_REGISTRY, value, onChange }: { month: string; entries?: readonly QrRegistryEntry[]; value?: QrSelection; onChange?: (selection: QrSelection) => void }) {
  const [local, setLocal] = useState(EMPTY_QR_SELECTION);
  const requested = value ?? local;
  const setRequested = onChange ?? setLocal;
  const { selection, campuses, buildings, placements, purposes, placeEntries, visibleEntries } = resolveQrSelection(entries, requested, month);
  const locationName = [campuses.find((o) => o.value === selection.campus)?.label, buildings.find((o) => o.value === selection.building)?.label, placements.find((o) => o.value === selection.placement)?.label].filter(Boolean).join(" · ");
  const scope = [selection.campus, selection.building, selection.placement, selection.purpose, ...placeEntries.map((e) => e.url)].join("|");
  const filter = (label: string, value: string, options: { value: string; label: string }[], change: (value: string) => void) => <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
    {label}<Select className={field} value={value} disabled={!options.length} onChange={(event) => change(event.target.value)}>
      {!options.length && <option value="">등록된 항목 없음</option>}
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  </label>;
  return <section className="flex flex-col gap-5" aria-label="등록된 QR 선택">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {filter("캠퍼스", selection.campus, campuses, (campus) => setRequested({ campus, building: "", placement: "", purpose: ALL_PURPOSES }))}
      {filter("건물", selection.building, buildings, (building) => setRequested({ ...selection, building, placement: "", purpose: ALL_PURPOSES }))}
      {filter("설치 장소", selection.placement, placements, (placement) => setRequested({ ...selection, placement, purpose: ALL_PURPOSES }))}
      {filter("QR 용도", selection.purpose, placeEntries.length ? [{ value: ALL_PURPOSES, label: "모든 용도" }, ...purposes] : [], (purpose) => setRequested({ ...selection, purpose }))}
    </div>
    {!placeEntries.length ? <p className="rounded-card border border-dashed border-border p-6 text-sm text-muted-foreground" role="status">현재 선택 가능한 등록 QR이 없습니다. 등록부의 장소·사용 상태·캠페인 월을 확인해 주세요.</p> : <>
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">{locationName}</h2>
        <PlaceDownloads key={scope} entries={placeEntries} name={`${selection.campus}_${selection.building}_${selection.placement}`} />
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        {visibleEntries.map((entry) => <article key={entry.url} className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4" data-qr-id={entry.qr_id}>
          <div><h3 className="text-base font-semibold text-foreground">{purposeLabel(entry.purpose)}</h3><p className="mt-1 text-xs text-muted-foreground">연결 화면: {UTM_LINK_PAGES.find((p) => p.path === entry.path)?.label ?? entry.path}</p></div>
          <QrResult key={entry.url} url={entry.url} pngName={registeredQrFileName(entry, "png")} svgName={registeredQrFileName(entry, "svg")} />
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {([['Source', entry.utm_source], ['Medium', entry.utm_medium], ['Campaign', entry.utm_campaign], ['Content', entry.utm_content]] as const).map(([label, value]) => <div className="contents" key={label}><dt>{label}</dt><dd className="break-all font-mono text-foreground">{value}</dd></div>)}
          </dl>
        </article>)}
      </div>
      <p className="text-xs text-muted-foreground">PNG는 1024px 이상, SVG는 인쇄용 벡터입니다. QR의 흰 여백을 유지하세요.</p>
    </>}
  </section>;
}
