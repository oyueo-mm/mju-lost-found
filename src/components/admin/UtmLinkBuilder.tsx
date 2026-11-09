"use client";

import { Select } from "@/components/ui/Select";

import { useEffect, useState } from "react";
import { QR_REGISTRY, qrLabel } from "@/lib/metrics/qrRegistry";
import { POSTER_CAMPAIGN } from "@/lib/metrics/utmStandard.mjs";

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
const LABEL = { path: "연결할 화면", source: "출처(utm_source)", medium: "매체(utm_medium)", campaign: "캠페인(utm_campaign)", content: "설치 위치·용도(utm_content)", registry: "등록부 일치" } as const;

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
  const [content, setContent] = useState("");
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<{ link: string; svg: string } | null>(null);
  const [qrError, setQrError] = useState(false);

  const result = buildUtmLink({ path, source, medium, campaign, content });
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
      save(qrFileName(result.source, result.campaign, "png", result.content), await QR.toDataURL(result.link, { ...QR_OPTIONS, scale, type: "image/png" }));
    } catch {
      setQrError(true);
    }
  };
  const downloadSvg = () => {
    if (!result.ok || !shown) return;
    const url = URL.createObjectURL(new Blob([shown.svg], { type: "image/svg+xml" }));
    save(qrFileName(result.source, result.campaign, "svg", result.content), url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const button =
    "shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

  return (
    <div className="flex flex-col gap-3 text-xs text-muted-foreground">
      <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
        <legend className="px-1 font-semibold text-foreground">포스터 UTM 표준 v1.0 · 등록부에서 선택</legend>
        <label>확정된 설치 장소·QR 용도
          <Select className={field} value={QR_REGISTRY.find((e) => e.url === link && e.status !== "retired")?.qr_id ?? ""} onChange={(event) => {
            const entry = QR_REGISTRY.find((e) => e.qr_id === event.target.value);
            if (!entry) return;
            setPath(entry.path); setSource(entry.utm_source); setMedium(entry.utm_medium);
            setCampaign(entry.utm_campaign); setContent(entry.utm_content);
          }}>
            <option value="">등록부의 QR을 선택하세요</option>
            {QR_REGISTRY.filter((e) => e.status !== "retired").map((e) => <option key={e.qr_id} value={e.qr_id}>{qrLabel(e.utm_content)} · {e.utm_campaign}</option>)}
          </Select>
        </label>
        {QR_REGISTRY.length === 0 && <p>확정된 장소 코드가 아직 등록되지 않았습니다. 건물명·코드 확인 후 운영 등록부에 추가하세요. 번호형 경비실 코드는 새로 발급하지 않습니다.</p>}
        <p>Source poster_qr · Medium offline · Campaign {POSTER_CAMPAIGN}. 설치 장소와 용도는 Content로 구분합니다. 분실물 검색은 검색 화면, 습득물 등록은 등록 화면으로 연결됩니다.</p>
        <p>등록부와 동일한 URL인지 확인한 뒤 인쇄하세요. 생성기는 등록부를 수정하지 않습니다. 기존 Content 없는 QR도 계속 작동하며 최초 유입만 집계합니다.</p>
      </fieldset>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="자주 쓰는 출처">
        {PRESETS.map((p) => (
          <button
            key={p.source}
            type="button"
            onClick={() => {
              setSource(p.source);
              setMedium(p.medium);
              if (p.source === "poster_qr") setCampaign(POSTER_CAMPAIGN);
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
          <Select className={field} value={path} onChange={(e) => setPath(e.target.value)}>
            {UTM_LINK_PAGES.map((p) => (
              <option key={p.path} value={p.path}>
                {p.label}
              </option>
            ))}
          </Select>
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
        <label className="flex flex-col gap-1">
          설치 위치·용도 utm_content (선택)
          <input className={field} value={content} maxLength={32} placeholder="등록부에서 확정된 Content" onChange={(e) => setContent(e.target.value)} />
          <span className={help}>예: h_jonghap_guard_find. 미등록 Content는 상세 집계에서 미등록으로 묶입니다.</span>
        </label>
      </div>
      {result.ok && result.content && <p role="status">{QR_REGISTRY.some((e) => e.url === result.link) ? "등록부 URL과 일치합니다." : "등록부 URL과 일치하지 않습니다. 신규 인쇄 전에 운영 등록부와 대조하세요. 미등록 캠페인×Content 조합은 상세 집계에서 묶입니다."}</p>}
      {!result.ok ? (
        <p role="alert" className="text-destructive">
          {result.invalid.includes("registry") ? "등록부의 캠페인·Content·용도·목적지와 일치하는 포스터 QR만 발급할 수 있습니다. 확정된 등록부 항목을 선택하세요." : `${result.invalid.map((k) => LABEL[k]).join(", ")}: 영문 소문자·숫자·-·_만, 32자 이내로 입력해 주세요(전화번호·학번·전체 날짜처럼 숫자 7자리 이상은 쓸 수 없음).`}
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
