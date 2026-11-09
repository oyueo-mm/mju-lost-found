// Shared by the browser, collector and Node registry validator.
export const UTM_STANDARD_VERSION = "1.0";
export const POSTER_CAMPAIGN = "poster_2026_11";
export const MAX_REGISTERED_QRS = 1024;
export const UNREGISTERED_CONTENT = "unregistered";
export const QR_REGISTRY_COLUMNS = ["qr_id", "status", "campus_code", "campus_name", "building_code", "building_name", "placement_code", "placement_name", "purpose", "utm_source", "utm_medium", "utm_campaign", "utm_content", "path", "url", "installed_on", "last_checked_on", "notes"];

/** @param {string} value */
export function validUtm(value) {
  return /^[a-z0-9_-]{1,32}$/.test(value) && !/\d{7,}/.test(value.replace(/[-_]/g, ""));
}

/** @param {string} campus @param {string} building @param {string} placement @param {string} purpose */
export function standardContent(campus, building, placement, purpose) {
  const content = `${campus}_${building}_${placement}_${purpose}`;
  if (!/^[a-z]{1,2}$/.test(campus) || !/^[a-z][a-z0-9]{0,11}$/.test(building)
    || !/^(guard|board[0-9]{2})$/.test(placement) || !["find", "reg"].includes(purpose) || !validUtm(content)) throw new Error("Invalid standard QR location or purpose");
  return content;
}

/** @param {{path:string, source:string, medium?:string|null, campaign?:string|null, content?:string|null}} input */
export function campaignUrl(input) {
  const q = new URLSearchParams({ utm_source: input.source });
  if (input.medium) q.set("utm_medium", input.medium);
  if (input.campaign) q.set("utm_campaign", input.campaign);
  if (input.content) q.set("utm_content", input.content);
  return `https://mju-find.vercel.app${input.path}?${q}`;
}
