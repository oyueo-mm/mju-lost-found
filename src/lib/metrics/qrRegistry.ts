import snapshot from "./qrRegistry.json";
import { UNREGISTERED_CONTENT } from "./utmStandard.mjs";

export type QrRegistryEntry = {
  qr_id: string; status: string; campus_code: string; campus_name: string;
  building_code: string; building_name: string; placement_code: string; placement_name: string;
  purpose: string; utm_source: string; utm_medium: string; utm_campaign: string;
  utm_content: string; path: string; url: string; installed_on: string; last_checked_on: string; notes: string;
};
export const QR_REGISTRY: QrRegistryEntry[] = snapshot.entries;
export function createQrAttribution(entries: readonly Pick<QrRegistryEntry, "utm_campaign" | "utm_content">[]) {
  const contents = new Set(entries.map((e) => e.utm_content));
  const pairs = new Set(entries.map((e) => `${e.utm_campaign}.${e.utm_content}`));
  return (campaign: string | null, content: string) => ({
    content: contents.has(content) ? content : UNREGISTERED_CONTENT,
    pair: campaign && pairs.has(`${campaign}.${content}`) ? `${campaign}.${content}` : `${UNREGISTERED_CONTENT}.${UNREGISTERED_CONTENT}`,
  });
}
export const registeredAttribution = createQrAttribution(QR_REGISTRY);
export function qrLabel(content: string) {
  if (content === UNREGISTERED_CONTENT) return "미등록 Content";
  const entry = QR_REGISTRY.find((e) => e.utm_content === content);
  return entry ? `${entry.campus_name} · ${entry.building_name} · ${entry.placement_name} · ${entry.purpose === "find" ? "분실물 검색" : "습득물 등록"}` : content;
}
