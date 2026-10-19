import { sanitizeUtm } from "./visits";

// 홍보 링크 (components/admin/UtmLinkBuilder): the one place a campaign link
// and its QR file name are made, so the copied link, the QR code and the
// downloaded files always carry the same URL. Only values the visit counter
// accepts (sanitizeUtm) can be used, so what is shared is what gets counted.
// Always the Production domain, also when made on a Preview deployment.

export const UTM_LINK_ORIGIN = "https://mju-find.vercel.app";

export const UTM_LINK_PAGES = [
  { path: "/", label: "홈" },
  { path: "/found", label: "습득물 게시판" },
  { path: "/lost", label: "분실물 게시판" },
  { path: "/search", label: "검색" },
] as const;
export type UtmLinkPath = (typeof UTM_LINK_PAGES)[number]["path"];

export type UtmLinkInput = { path: string; source: string; medium: string; campaign: string };
export type UtmLinkResult =
  | { ok: true; link: string; source: string; medium: string | null; campaign: string | null }
  | { ok: false; invalid: ("source" | "medium" | "campaign")[] };

export function buildUtmLink({ path, source, medium, campaign }: UtmLinkInput): UtmLinkResult {
  const page = UTM_LINK_PAGES.find((p) => p.path === path)?.path ?? "/";
  const s = sanitizeUtm(source);
  const m = medium.trim() ? sanitizeUtm(medium) : null;
  const c = campaign.trim() ? sanitizeUtm(campaign) : null;
  const invalid = [!s && "source", medium.trim() && !m && "medium", campaign.trim() && !c && "campaign"].filter(Boolean) as ("source" | "medium" | "campaign")[];
  if (invalid.length) return { ok: false, invalid };
  const q = new URLSearchParams({ utm_source: s! });
  if (m) q.set("utm_medium", m);
  if (c) q.set("utm_campaign", c);
  return { ok: true, link: `${UTM_LINK_ORIGIN}${page}?${q.toString()}`, source: s!, medium: m, campaign: c };
}

// "mju-find-qr_instagram_october_promo.png" -- the parts are already
// limited to a-z, 0-9, - and _, so they are safe in any file system.
export function qrFileName(source: string, campaign: string | null, ext: "png" | "svg"): string {
  return `mju-find-qr_${[source, campaign].filter(Boolean).join("_")}.${ext}`;
}

// QR look shared by the preview and the files: black on white, quiet zone
// of 4 modules (the standard minimum), medium error correction.
export const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 4, color: { dark: "#000000", light: "#ffffff" } } as const;
export const QR_PNG_SIZE = 1024;
// whole pixels per module, at least QR_PNG_SIZE in all (a `width` option is
// rounded down by the browser renderer: 1023 px)
export function qrPngScale(moduleCount: number): number {
  return Math.ceil(QR_PNG_SIZE / (moduleCount + 2 * QR_OPTIONS.margin));
}
