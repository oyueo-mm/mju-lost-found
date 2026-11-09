import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { QR_REGISTRY } from "./qrRegistry";
import { qrArchive, qrImage, registeredQrFileName } from "./qrDownloads";

const entries = QR_REGISTRY.filter((e) => e.building_code === "jonghap");
describe("place QR download archives", () => {
  it.each(["png", "svg"] as const)("exports two distinct %s images and their exact registry URLs", async (format) => {
    const archive = unzipSync(await qrArchive(entries, format));
    expect(Object.keys(archive).sort()).toEqual([`h_jonghap_guard_find.${format}`, `h_jonghap_guard_reg.${format}`, "qr-links.json"].sort());
    const links = JSON.parse(strFromU8(archive["qr-links.json"]));
    expect(links.map((e: { url: string }) => e.url)).toEqual(entries.map((e) => e.url));
    for (const [i, entry] of entries.entries()) {
      const name = registeredQrFileName(entry, format);
      expect(links[i]).toMatchObject({ file: name, qr_id: entry.qr_id, content: entry.utm_content, campaign: entry.utm_campaign });
      if (format === "svg") expect(strFromU8(archive[name])).toContain('<svg');
      else {
        const png = archive[name];
        expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBeGreaterThanOrEqual(1024);
      }
    }
    expect(archive[registeredQrFileName(entries[0], format)]).not.toEqual(archive[registeredQrFileName(entries[1], format)]);
  });

  it("supports a place with one purpose and rejects empty, duplicate or unsafe filenames", async () => {
    const archive = unzipSync(await qrArchive(entries.slice(0, 1), "svg"));
    expect(Object.keys(archive)).toHaveLength(2);
    await expect(qrArchive([], "png")).rejects.toThrow();
    await expect(qrArchive([entries[0], entries[0]], "svg")).rejects.toThrow(/Duplicate/);
    expect(() => registeredQrFileName({ ...entries[0], utm_content: "../escape" }, "svg")).toThrow();
  });

  it("keeps individual SVG/PNG generation available for direct URLs", async () => {
    const url = "https://mju-find.vercel.app/search?utm_source=instagram&utm_content=story";
    expect(new TextDecoder().decode(await qrImage(url, "svg"))).toContain('<svg');
    expect((await qrImage(url, "png")).length).toBeGreaterThan(1000);
  });
});
