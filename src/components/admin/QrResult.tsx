"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { qrImage, qrSvg, saveQrBytes, type QrFormat } from "@/lib/metrics/qrDownloads";

export const qrButton = "rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

// Parents key by URL. A selection change unmounts this instance, immediately
// hides its preview and cancels any pending save/copy completion.
export function QrResult({ url, pngName, svgName }: { url: string; pngName: string; svgName: string }) {
  const [preview, setPreview] = useState<{ url: string; svg: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<QrFormat | null>(null);
  const active = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    qrSvg(url).then((svg) => { if (current) setPreview({ url, svg }); }).catch(() => { if (current) setError("QR을 만들지 못했습니다. 다시 선택해 주세요."); });
    return () => { current = false; };
  }, [url]);
  const shown = preview?.url === url ? preview : null;
  const download = async (format: QrFormat) => {
    if (!shown || saving) return;
    setSaving(format); setError("");
    try {
      const bytes = format === "svg" ? new TextEncoder().encode(shown.svg) : await qrImage(url, format);
      if (active.current) saveQrBytes(format === "png" ? pngName : svgName, bytes, format === "png" ? "image/png" : "image/svg+xml");
    } catch { if (active.current) setError("파일을 저장하지 못했습니다. 다시 시도해 주세요."); }
    finally { if (active.current) setSaving(null); }
  };
  return (
    <div className="flex min-w-0 flex-col items-center gap-3">
      <div className="flex size-48 items-center justify-center rounded-lg border border-border bg-white p-1">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- QR SVG generated locally from this exact URL
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(shown.svg)}`} alt="선택한 링크의 QR 코드" data-qr-link={url} className="size-full" />
        ) : <span className="text-xs text-neutral-500" role="status">{error || "QR 준비 중…"}</span>}
      </div>
      <code className="w-full rounded-lg bg-muted/40 p-2 text-[11px] break-all text-foreground" data-qr-url={url}>{url}</code>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={`${qrButton} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} onClick={async () => {
          try { await navigator.clipboard.writeText(url); if (active.current) setCopied(true); }
          catch { if (active.current) setError("URL을 복사하지 못했습니다. 주소를 직접 선택해 복사해 주세요."); }
        }}>{copied ? "복사됨" : "URL 복사"}</button>
        <button type="button" className={qrButton} disabled={!shown || !!saving} onClick={() => download("png")}>{saving === "png" ? "PNG 준비 중…" : "PNG 다운로드"}</button>
        <button type="button" className={qrButton} disabled={!shown || !!saving} onClick={() => download("svg")}>{saving === "svg" ? "SVG 준비 중…" : "SVG 다운로드"}</button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
