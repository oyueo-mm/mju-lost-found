import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { campaignUrl, MAX_REGISTERED_QRS, QR_REGISTRY_COLUMNS, standardContent, UTM_STANDARD_VERSION, validUtm } from "../../src/lib/metrics/utmStandard.mjs";

// RFC 4180 fields, including quoted commas, double quotes and line breaks.
export function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { field += '"'; i++; }
      else if (!field || quoted) quoted = !quoted;
      else throw new Error("Invalid CSV quote");
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field); field = "";
      if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; }
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function validateRegistry(csv, buildings) {
  const [header, ...rows] = parseCsv(csv);
  if (JSON.stringify(header) !== JSON.stringify(QR_REGISTRY_COLUMNS)) throw new Error("QR registry columns differ from v1.0");
  if (rows.length > MAX_REGISTERED_QRS) throw new Error("Registry exceeds 1024 immutable QR definitions; review capacity first");
  const ids = new Set(), pairs = new Set(), contentLocations = new Map();
  const entries = rows.map((values, i) => {
    const fail = (message) => { throw new Error(`CSV row ${i + 2}: ${message}`); };
    if (values.length !== header.length) fail("column count");
    const e = Object.fromEntries(header.map((key, n) => [key, values[n]]));
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(e.qr_id) || ids.has(e.qr_id)) fail("invalid or duplicate qr_id");
    ids.add(e.qr_id);
    if (!["ready", "installed", "retired"].includes(e.status)) fail("status must be ready, installed or retired");
    const building = buildings.find((b) => b.campus_code === e.campus_code && b.building_code === e.building_code);
    if (!building || !building.confirmed_on || !building.confirmed_by || building.campus_name !== e.campus_name || building.building_name !== e.building_name) fail("building code/name has not been confirmed");
    if (!e.placement_name || e.utm_content !== standardContent(e.campus_code, e.building_code, e.placement_code, e.purpose)) fail("content differs from location/purpose");
    if (e.utm_source !== "poster_qr" || e.utm_medium !== "offline" || !/^poster_\d{4}_\d{2}$/.test(e.utm_campaign) || !validUtm(e.utm_campaign)) fail("poster source/medium/campaign");
    if (+e.utm_campaign.slice(-2) < 1 || +e.utm_campaign.slice(-2) > 12) fail("campaign month");
    if (e.path !== (e.purpose === "find" ? "/search" : "/found/new")) fail("purpose/destination");
    if (e.url !== campaignUrl({ path: e.path, source: e.utm_source, medium: e.utm_medium, campaign: e.utm_campaign, content: e.utm_content })) fail("URL differs from generator");
    const pair = `${e.utm_campaign}.${e.utm_content}`;
    if (pairs.has(pair)) fail("duplicate campaign/content"); pairs.add(pair);
    const location = `${e.campus_name}|${e.building_name}|${e.placement_name}|${e.purpose}`;
    if (contentLocations.has(e.utm_content) && contentLocations.get(e.utm_content) !== location) fail("content reused for another location");
    contentLocations.set(e.utm_content, location);
    for (const key of ["installed_on", "last_checked_on"]) if (e[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(e[key]) || new Date(e[key]).toISOString().slice(0, 10) !== e[key])) fail("invalid date");
    if (e.status === "installed" && !e.installed_on) fail("installed date required");
    return e;
  });
  return { version: UTM_STANDARD_VERSION, entries };
}

export function validateRegistryRevision(previous, next) {
  const immutable = ["qr_id", "campus_code", "building_code", "placement_code", "purpose", "utm_source", "utm_medium", "utm_campaign", "utm_content", "path", "url"];
  for (const old of previous.entries) {
    const entry = next.entries.find((e) => e.qr_id === old.qr_id);
    if (!entry) throw new Error(`Do not delete issued QR definition: ${old.qr_id}; mark it retired`);
    for (const key of immutable) if (entry[key] !== old[key]) throw new Error(`Immutable QR field changed: ${old.qr_id}.${key}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateRegistry(readFileSync("docs/operations/qr-registry.csv", "utf8"), JSON.parse(readFileSync("docs/operations/buildings.json", "utf8")));
  const path = "src/lib/metrics/qrRegistry.json";
  validateRegistryRevision(JSON.parse(readFileSync(path, "utf8")), result);
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
  else if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(result)) throw new Error("Registry snapshot is stale; run node scripts/operations/validate-qr-registry.mjs --write");
  console.log(`QR registry v${result.version}: ${result.entries.length} validated definitions`);
}
