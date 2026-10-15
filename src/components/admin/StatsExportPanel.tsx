"use client";

import { useState, useTransition } from "react";

import { exportStatsAction, type StatsExportInput } from "@/app/(main)/admin/stats/actions";
import { DATASETS } from "@/lib/metrics/exportOptions";

type Unit = "day" | "week" | "month";
const UNIT_LABEL: Record<Unit, string> = { day: "일별 30일", week: "주별 12주", month: "월별 12개월" };

// 운영 통계 내보내기 (/admin/stats). The file is built by an admin-only
// Server Action and handed back here to save; nothing is kept on the server.
export function StatsExportPanel({ unit, today }: { unit: Unit; today: string }) {
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [period, setPeriod] = useState<StatsExportInput["period"]>("dashboard");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);
  const [dataset, setDataset] = useState<string>("summary");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await exportStatsAction({ format, period, unit, from: from || undefined, to: to || undefined, dataset });
        if (!result.ok) {
          setMessage({ kind: "error", text: result.error });
          return;
        }
        const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setMessage({ kind: "ok", text: `${result.filename} 파일을 저장했습니다.` });
      } catch {
        setMessage({ kind: "error", text: "파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." });
      }
    });
  };

  const field = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground";
  return (
    <div className="flex flex-col gap-3 text-xs text-muted-foreground">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-foreground">형식</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["xlsx", "Excel (.xlsx) · 권장"],
              ["csv", "CSV (.csv)"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                format === value ? "border-primary bg-primary-muted text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <input type="radio" name="format" value={value} checked={format === value} onChange={() => setFormat(value)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          기간
          <select className={field} value={period} onChange={(e) => setPeriod(e.target.value as StatsExportInput["period"])}>
            <option value="dashboard">현재 화면 기간 ({UNIT_LABEL[unit]})</option>
            <option value="7">최근 7일</option>
            <option value="30">최근 30일</option>
            <option value="90">최근 90일</option>
            <option value="custom">직접 지정</option>
          </select>
        </label>
        {format === "csv" && (
          <label className="flex flex-col gap-1">
            CSV 데이터 (파일 1개에 1종류)
            <select className={field} value={dataset} onChange={(e) => setDataset(e.target.value)}>
              {DATASETS.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {period === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            시작일
            <input type="date" className={field} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            종료일
            <input type="date" className={field} value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
      <p className="leading-relaxed">
        {format === "xlsx"
          ? "운영 요약·방문 통계·유입 분석·서비스 이용·완료 처리·서버 운영 6개 시트로 저장됩니다."
          : "CSV는 시트가 없어 고른 데이터 1종류만 저장됩니다. 맨 위 # 줄은 기간·주의사항입니다."}{" "}
        직접 지정은 최대 366일, 최근·직접 지정 기간은 일별로 저장됩니다. 개인정보(실명·이메일·회원 식별자·IP·검색어)는 포함되지 않습니다.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {pending ? "만드는 중…" : "내보내기"}
        </button>
        {message && (
          <span role="status" className={message.kind === "error" ? "text-destructive" : "text-success"}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
