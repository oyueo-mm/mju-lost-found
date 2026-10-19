"use client";

import { useMemo, useState } from "react";

import { sanitizeUtm } from "@/lib/metrics/visits";

// 홍보 링크 만들기 (날짜별 방문 분석 > 유입 경로): a MJU Find link with UTM
// tags for a post on 에브리타임, Instagram, a poster QR code ... so those
// visits show up under their own source. Only values the visit counter
// accepts can be made (lower-case letters, digits, - and _, at most 32;
// no long digit runs): what is copied is exactly what will be counted.
// Nothing is sent or stored; the link is built in the browser.

const ORIGIN = "https://mju-find.vercel.app";
const PAGES = [
  { path: "/", label: "홈" },
  { path: "/found", label: "습득물 게시판" },
  { path: "/lost", label: "분실물 게시판" },
  { path: "/search", label: "검색" },
] as const;
const PRESETS = [
  { label: "에브리타임 게시글", source: "everytime", medium: "community" },
  { label: "인스타그램", source: "instagram", medium: "social" },
  { label: "카카오톡 공유", source: "kakao", medium: "messenger" },
  { label: "포스터 QR", source: "poster_qr", medium: "offline" },
] as const;
const field = "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";

export function UtmLinkBuilder() {
  const [path, setPath] = useState<string>("/");
  const [source, setSource] = useState("everytime");
  const [medium, setMedium] = useState("community");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState(false);

  const checked = {
    source: sanitizeUtm(source),
    medium: medium ? sanitizeUtm(medium) : null,
    campaign: campaign ? sanitizeUtm(campaign) : null,
  };
  const errors = [
    !checked.source && "출처(utm_source)",
    medium && !checked.medium && "매체(utm_medium)",
    campaign && !checked.campaign && "캠페인(utm_campaign)",
  ].filter(Boolean);
  const link = useMemo(() => {
    if (errors.length) return null;
    const q = new URLSearchParams({ utm_source: checked.source! });
    if (checked.medium) q.set("utm_medium", checked.medium);
    if (checked.campaign) q.set("utm_campaign", checked.campaign);
    return `${ORIGIN}${path}?${q.toString()}`;
  }, [path, checked.source, checked.medium, checked.campaign, errors.length]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 text-xs text-muted-foreground">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="자주 쓰는 출처">
        {PRESETS.map((p) => (
          <button
            key={p.source}
            type="button"
            onClick={() => {
              setSource(p.source);
              setMedium(p.medium);
            }}
            className={`rounded-full border px-3 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              source === p.source ? "border-primary bg-primary-muted text-primary" : "border-border hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          연결할 화면
          <select className={field} value={path} onChange={(e) => setPath(e.target.value)}>
            {PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          출처 utm_source (필수)
          <input className={field} value={source} maxLength={32} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          매체 utm_medium
          <input className={field} value={medium} maxLength={32} onChange={(e) => setMedium(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          캠페인 utm_campaign
          <input className={field} value={campaign} maxLength={32} placeholder="예: 2026-fall" onChange={(e) => setCampaign(e.target.value)} />
        </label>
      </div>
      {errors.length > 0 ? (
        <p role="alert" className="text-destructive">
          {errors.join(", ")}: 영문 소문자·숫자·-·_만, 32자 이내로 입력해 주세요(전화번호·학번·전체 날짜처럼 숫자 7자리 이상은 쓸 수 없음).
        </p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-2 py-2 text-[11px] break-all text-foreground">{link}</code>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
          >
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
      )}
      <p className="leading-relaxed">
        이 링크로 시작한 방문은 리퍼러와 관계없이 이 출처로 셉니다(앱 안 브라우저처럼 리퍼러가 빠지는 경우도 구분됨). 개인정보·연락처·검색어는 넣지
        마세요. QR 코드는 이 링크를 QR 생성기에 넣어 만들면 됩니다.
      </p>
    </div>
  );
}
