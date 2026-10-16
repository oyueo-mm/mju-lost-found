import type { StatsExportResult } from "@/app/(main)/admin/stats/actions";

// Hands a file built by exportStatsAction to the browser to save. Returns
// the message to show.
export function saveExport(result: StatsExportResult): { kind: "error" | "ok"; text: string } {
  if (!result.ok) return { kind: "error", text: result.error };
  const bytes = Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { kind: "ok", text: `${result.filename} 파일을 저장했습니다.` };
}
