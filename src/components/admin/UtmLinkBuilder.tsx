"use client";

import { useEffect, useState } from "react";

import { buildUtmLink, QR_OPTIONS, QR_PNG_SIZE, qrFileName, qrPngScale, UTM_LINK_PAGES } from "@/lib/metrics/utmLink";

// 홍보 링크 만들기 (날짜별 방문 분석 > 유입 경로): a MJU Find link with UTM
// tags for a post on 에브리타임, Instagram, a poster QR code ... so those
// visits show up under their own source. Only values the visit counter
// accepts can be made (lib/metrics/utmLink.ts): what is copied is exactly
// what will be counted. The QR code is drawn from that same link in the
// browser (qrcode, loaded on demand; no outside QR service), shown live
// and saved as PNG (1024 px) or SVG. Nothing is sent or stored.

const PRESETS = [
  { label: "에브리타임 게시글", source: "everytime", medium: "community" },
  { label: "인스타그램", source: "instagram", medium: "social" },
  { label: "카카오톡 공유", source: "kakao", medium: "messenger" },
  { label: "포스터 QR", source: "poster_qr", medium: "offline" },
] as const;
const field = "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground";
const help = "text-[11px] leading-snug text-muted-foreground";
const LABEL = { source: "출처(utm_source)", medium: "매체(utm_medium)", campaign: "캠페인(utm_campaign)" } as const;

function save(name: string, href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export function UtmLinkBuilder() {
  const [path, setPath] = useState<string>("/");
  const [source, setSource] = useState("everytime");
  const [medium, setMedium] = useState("community");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<{ link: string; svg: string } | null>(null);
  const [qrError, setQrError] = useState(false);

  const result = buildUtmLink({ path, source, medium, campaign });
  const link = result.ok ? result.link : null;

  // the QR follows the link (stale drawings are dropped)
  useEffect(() => {
    if (!link) return;
    let current = true;
    import("qrcode")
      .then((QR) => QR.toString(link, { ...QR_OPTIONS, type: "svg" }))
      .then((svg) => {
        if (!current) return;
        setQr({ link, svg });
        setQrError(false);
      })
      .catch(() => current && setQrError(true));
    return () => {
      current = false;
    };
  }, [link]);
  const shown = qr && qr.link === link ? qr : null;

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

  const downloadPng = async () => {
    if (!result.ok) return;
    try {
      const QR = await import("qrcode");
      const scale = qrPngScale(QR.create(result.link, QR_OPTIONS).modules.size);
      save(qrFileName(result.source, result.campaign, "png"), await QR.toDataURL(result.link, { ...QR_OPTIONS, scale, type: "image/png" }));
    } catch {
      setQrError(true);
    }
  };
  const downloadSvg = () => {
    if (!result.ok || !shown) return;
    const url = URL.createObjectURL(new Blob([shown.svg], { type: "image/svg+xml" }));
    save(qrFileName(result.source, result.campaign, "svg"), url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const button =
    "shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          연결할 화면
          <select className={field} value={path} onChange={(e) => setPath(e.target.value)}>
            {UTM_LINK_PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </select>
          <span className={help}>링크나 QR 코드로 접속했을 때 처음 표시할 화면입니다.</span>
        </label>
        <label className="flex flex-col gap-1">
          출처 utm_source (필수)
          <input className={field} value={source} maxLength={32} onChange={(e) => setSource(e.target.value)} />
          <span className={help}>방문자가 어디에서 왔는지 구분합니다. 예: instagram, everytime</span>
        </label>
        <label className="flex flex-col gap-1">
          매체 utm_medium (선택)
          <input className={field} value={medium} maxLength={32} onChange={(e) => setMedium(e.target.value)} />
          <span className={help}>어떤 방식으로 홍보했는지 구분합니다. 예: social, post, qr</span>
        </label>
        <label className="flex flex-col gap-1">
          캠페인 utm_campaign (선택)
          <input className={field} value={campaign} maxLength={32} placeholder="예: october_promo" onChange={(e) => setCampaign(e.target.value)} />
          <span className={help}>같은 출처의 홍보 활동을 구분합니다. 예: october_promo, campus_poster</span>
        </label>
      </div>
      {!result.ok ? (
        <p role="alert" className="text-destructive">
          {result.invalid.map((k) => LABEL[k]).join(", ")}: 영문 소문자·숫자·-·_만, 32자 이내로 입력해 주세요(전화번호·학번·전체 날짜처럼 숫자 7자리 이상은 쓸 수
          없음).
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {/* QR: black on white with its quiet zone, also in dark mode; the
              exact link (the one copied) right under it */}
          <figure className="flex w-full max-w-xs shrink-0 flex-col items-center gap-2 sm:w-56">
            <div className="flex size-44 items-center justify-center rounded-lg border border-border bg-white p-1">
              {shown ? (
                // eslint-disable-next-line @next/next/no-img-element -- an SVG drawn in the browser, not a remote photo
                <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown.svg)}`} alt={`홍보 링크 QR 코드: ${link}`} className="size-full" data-qr-link={link} />
              ) : (
                <span className="text-[11px] text-neutral-500">{qrError ? "QR 코드를 만들지 못했습니다." : "QR 코드 만드는 중…"}</span>
              )}
            </div>
            <figcaption className="w-full">
              <code className="block rounded-lg border border-border bg-muted/40 px-2 py-2 text-[11px] break-all text-foreground">{link}</code>
            </figcaption>
          </figure>
          <div className="flex w-full min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
              >
                {copied ? "복사됨" : "링크 복사"}
              </button>
              <button type="button" onClick={downloadPng} disabled={!shown} className={button}>
                PNG 저장 (고해상도)
              </button>
              <button type="button" onClick={downloadSvg} disabled={!shown} className={button}>
                SVG 저장
              </button>
            </div>
            <p className={help}>PNG는 {QR_PNG_SIZE}px 이상 정사각형, SVG는 크기 제한 없는 벡터입니다. 흰 여백까지 그대로 인쇄하세요.</p>
            {qrError && <p role="alert" className="text-destructive">QR 코드를 만들지 못했습니다. 링크 복사는 그대로 쓸 수 있습니다.</p>}
          </div>
        </div>
      )}
      <p className="leading-relaxed">
        이 링크나 QR 코드로 시작한 방문은 리퍼러와 관계없이 이 출처로 셉니다(앱 안 브라우저처럼 리퍼러가 빠지는 경우도 구분됨). 링크와 QR은 언제나 실제 서비스
        주소(mju-find.vercel.app)로 연결됩니다. 개인정보·연락처·검색어는 넣지 마세요.
      </p>
    </div>
  );
}
