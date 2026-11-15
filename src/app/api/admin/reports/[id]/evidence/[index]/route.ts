import { NextRequest, NextResponse } from "next/server";
import { requireAdminForApi, jsonError, withErrorHandling } from "@/lib/moderation/http";
import { getReportEvidenceImages } from "@/lib/report/evidenceView";

// Keep private images out of both browser/CDN caches and Next's optimizer.
// The Storage URL is short-lived and remains on the server; every image
// request checks the current session/permission and records chat access.
export const GET = withErrorHandling(async (_request: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) => {
  const auth = await requireAdminForApi("reports.view");
  if ("response" in auth) return auth.response;
  const values = await params;
  const id = Number(values.id);
  const index = Number(values.index);
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(index) || index < 0 || index >= 5) return jsonError(400, "잘못된 사진 번호입니다.");
  const image = (await getReportEvidenceImages(auth.user, id, index))?.find((i) => i.index === index);
  if (!image?.url) return jsonError(404, "증거 사진을 불러올 수 없습니다.");
  const upstream = await fetch(image.url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!upstream.ok) return jsonError(502, "증거 사진을 불러올 수 없습니다.");
  const type = upstream.headers.get("content-type")?.split(";")[0];
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) return jsonError(502, "사진 형식이 올바르지 않습니다.");
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
});
