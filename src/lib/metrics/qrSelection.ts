import type { QrRegistryEntry } from "./qrRegistry";

export type QrSelection = { campus: string; building: string; placement: string; purpose: string };
export const ALL_PURPOSES = "all";
export const purposeLabel = (purpose: string) => purpose === "find" ? "분실물 찾기" : purpose === "reg" ? "습득물 등록" : "기타 QR";
export const EMPTY_QR_SELECTION: QrSelection = { campus: "", building: "", placement: "", purpose: ALL_PURPOSES };

// Select actual rows, never construct or rewrite a registered campaign/URL.
// A ready/installed campaign is usable from its named month onward. With
// no expiry field in v1.0, retired is the only explicit end-of-use state.
export function currentQrEntries(entries: readonly QrRegistryEntry[], month: string): QrRegistryEntry[] {
  const byPurpose = new Map<string, QrRegistryEntry>();
  for (const entry of entries) {
    if (entry.status !== "ready" && entry.status !== "installed") continue;
    const date = /^poster_(\d{4})_(\d{2})$/.exec(entry.utm_campaign);
    if (!date || `${date[1]}-${date[2]}` > month) continue;
    const key = [entry.campus_code, entry.building_code, entry.placement_code, entry.purpose].join("/");
    const previous = byPurpose.get(key);
    if (!previous || previous.utm_campaign < entry.utm_campaign || (previous.utm_campaign === entry.utm_campaign && previous.qr_id > entry.qr_id)) byPurpose.set(key, entry);
  }
  return [...byPurpose.values()];
}

const options = (entries: readonly QrRegistryEntry[], key: "campus_code" | "building_code" | "placement_code", label: "campus_name" | "building_name" | "placement_name") =>
  [...new Map(entries.map((entry) => [entry[key], { value: entry[key], label: entry[label] }])).values()];
const choose = (list: { value: string }[], desired: string) => list.some((o) => o.value === desired) ? desired : list[0]?.value ?? "";

export function resolveQrSelection(entries: readonly QrRegistryEntry[], requested: QrSelection, month: string) {
  const current = currentQrEntries(entries, month);
  const campuses = options(current, "campus_code", "campus_name");
  const campus = choose(campuses, requested.campus);
  const campusRows = current.filter((e) => e.campus_code === campus);
  const buildings = options(campusRows, "building_code", "building_name");
  const building = choose(buildings, requested.building);
  const buildingRows = campusRows.filter((e) => e.building_code === building);
  const placements = options(buildingRows, "placement_code", "placement_name");
  const placement = choose(placements, requested.placement);
  const placeEntries = buildingRows.filter((e) => e.placement_code === placement).sort((a, b) => {
    const order = (p: string) => p === "find" ? 0 : p === "reg" ? 1 : 2;
    return order(a.purpose) - order(b.purpose) || a.purpose.localeCompare(b.purpose);
  });
  const purposes = [...new Set(placeEntries.map((e) => e.purpose))].map((value) => ({ value, label: purposeLabel(value) }));
  const purpose = purposes.some((o) => o.value === requested.purpose) ? requested.purpose : ALL_PURPOSES;
  return { campuses, buildings, placements, purposes, selection: { campus, building, placement, purpose }, placeEntries,
    visibleEntries: purpose === ALL_PURPOSES ? placeEntries : placeEntries.filter((e) => e.purpose === purpose) };
}
