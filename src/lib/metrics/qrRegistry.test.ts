import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, validateRegistry, validateRegistryRevision } from "../../../scripts/operations/validate-qr-registry.mjs";
import { createQrAttribution, QR_REGISTRY } from "./qrRegistry";
import { buildUtmLink, qrFileName } from "./utmLink";
import { QR_REGISTRY_COLUMNS } from "./utmStandard.mjs";

const csv = readFileSync("docs/operations/qr-registry.csv", "utf8");
const buildings = JSON.parse(readFileSync("docs/operations/buildings.json", "utf8"));
const mutate = (key: string, value: string) => {
  const rows = parseCsv(csv);
  rows[1][QR_REGISTRY_COLUMNS.indexOf(key)] = value;
  return rows.map((r: string[]) => r.join(",")).join("\n");
};

describe("UTM standard v1.0 registry", () => {
  it("has exactly 8 approved guard locations and 16 distinct generated URLs matching the canonical CSV", () => {
    const validated = validateRegistry(csv, buildings);
    expect(validated.entries).toEqual(QR_REGISTRY);
    expect(QR_REGISTRY).toHaveLength(16);
    expect(new Set(QR_REGISTRY.map((e) => e.building_code)).size).toBe(8);
    expect(QR_REGISTRY.filter((e) => e.building_code === "mcc")).toHaveLength(2);
    for (const entry of QR_REGISTRY) {
      const result = buildUtmLink({ path: entry.path, source: entry.utm_source, medium: entry.utm_medium, campaign: entry.utm_campaign, content: entry.utm_content });
      expect(result.ok && result.link).toBe(entry.url);
      expect(entry.status).toBe("ready");
      expect(entry.installed_on).toBe("");
      expect(entry.utm_content).not.toMatch(/guard0[1-8]/);
    }
    expect(qrFileName("poster_qr", "poster_2026_11", "png", "h_jonghap_guard_reg")).toContain("h_jonghap_guard_reg");
  });

  it.each([
    ["building_code", "unapproved"], ["building_name", "imaginary building"],
    ["utm_content", "h_mcc_guard_reg"], ["path", "/admin"], ["url", "https://evil.example"],
    ["status", "installed"], ["purpose", "register"], ["utm_campaign", "poster_2026_99"],
  ])("rejects registry mismatch %s", (key, value) => {
    expect(() => validateRegistry(mutate(key, value), buildings)).toThrow();
  });

  it("rejects duplicate definitions and oversized registries", () => {
    const rows = csv.trim().split("\n");
    expect(() => validateRegistry(csv + rows[1] + "\n", buildings)).toThrow(/duplicate/);
    expect(() => validateRegistry([rows[0], ...Array(1025).fill(rows[1])].join("\n"), buildings)).toThrow(/1024/);
  });

  it("blocks new poster QR issuance with unapproved places or mismatched purpose/campaign", () => {
    const entry = QR_REGISTRY[0];
    const input = { path: entry.path, source: entry.utm_source, medium: entry.utm_medium, campaign: entry.utm_campaign, content: entry.utm_content };
    expect(buildUtmLink({ ...input, content: "h_unknown_guard_find" })).toEqual({ ok: false, invalid: ["registry"] });
    expect(buildUtmLink({ ...input, path: "/found/new" })).toEqual({ ok: false, invalid: ["registry"] });
    expect(buildUtmLink({ ...input, campaign: "poster_2026_12" })).toEqual({ ok: false, invalid: ["registry"] });
  });

  it("parses quoted commas, escaped quotes and multiline notes", () => {
    expect(parseCsv('a,b\r\n"x,y","z""w\nline"\r\n')).toEqual([["a", "b"], ["x,y", 'z"w\nline']]);
    expect(() => parseCsv('a,"unterminated')).toThrow();
  });

  it("keeps issued definitions immutable while permitting installation and retirement updates", () => {
    const before = { entries: QR_REGISTRY };
    expect(() => validateRegistryRevision(before, { entries: QR_REGISTRY.slice(1) })).toThrow(/delete/);
    expect(() => validateRegistryRevision(before, { entries: QR_REGISTRY.map((e, i) => i ? e : { ...e, path: "/found" }) })).toThrow(/Immutable/);
    expect(() => validateRegistryRevision(before, { entries: QR_REGISTRY.map((e) => ({ ...e, status: "retired", notes: "removed" })) })).not.toThrow();
  });

  it("does not cap approved Content at 30 or allow visitor-controlled cross products", () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ utm_campaign: `campaign_${i}`, utm_content: `h_building${i}_guard_find` }));
    const classify = createQrAttribution(entries);
    for (const entry of entries) expect(classify(entry.utm_campaign, entry.utm_content)).toEqual({ content: entry.utm_content, pair: `${entry.utm_campaign}.${entry.utm_content}` });
    expect(classify("campaign_1", entries[2].utm_content).pair).toBe("unregistered.unregistered");
    expect(classify("anything", "anything")).toEqual({ content: "unregistered", pair: "unregistered.unregistered" });
  });
});
