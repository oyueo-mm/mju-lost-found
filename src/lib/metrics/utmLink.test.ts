import QRCode from "qrcode";
import { describe, expect, it } from "vitest";

import { buildUtmLink, QR_OPTIONS, QR_PNG_SIZE, qrFileName, qrPngScale, UTM_LINK_ORIGIN } from "./utmLink";

const input = { path: "/", source: "everytime", medium: "community", campaign: "" };

describe("홍보 링크", () => {
  it("always links to the Production domain, with the chosen page and tags", () => {
    expect(UTM_LINK_ORIGIN).toBe("https://mju-find.vercel.app");
    expect(buildUtmLink({ ...input, source: "poster_qr", medium: "offline" })).toMatchObject({
      ok: true,
      link: "https://mju-find.vercel.app/?utm_source=poster_qr&utm_medium=offline",
    });
    const r = buildUtmLink({ path: "/found", source: "instagram", medium: "social", campaign: "october_promo" });
    expect(r.ok && r.link).toBe("https://mju-find.vercel.app/found?utm_source=instagram&utm_medium=social&utm_campaign=october_promo");
  });

  it("medium and campaign are optional; an unknown page falls back to home", () => {
    const r = buildUtmLink({ path: "/admin", source: "kakao", medium: " ", campaign: "" });
    expect(r.ok && r.link).toBe("https://mju-find.vercel.app/?utm_source=kakao");
  });

  it("refuses what the visit counter would not count", () => {
    expect(buildUtmLink({ ...input, source: "" })).toEqual({ ok: false, invalid: ["source"] });
    expect(buildUtmLink({ ...input, medium: "Social Media" })).toEqual({ ok: false, invalid: ["medium"] });
    expect(buildUtmLink({ ...input, campaign: "010-1234-5678" })).toEqual({ ok: false, invalid: ["campaign"] });
    expect(buildUtmLink({ ...input, campaign: "a".repeat(33) })).toEqual({ ok: false, invalid: ["campaign"] });
  });

  it("names the QR files after the source and campaign", () => {
    expect(qrFileName("instagram", "october_promo", "png")).toBe("mju-find-qr_instagram_october_promo.png");
    expect(qrFileName("poster_qr", null, "svg")).toBe("mju-find-qr_poster_qr.svg");
  });

  it("draws a black-on-white QR with a quiet zone, PNG at 1024 px", async () => {
    const link = "https://mju-find.vercel.app/?utm_source=poster_qr&utm_medium=offline";
    const svg = await QRCode.toString(link, { ...QR_OPTIONS, type: "svg" });
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('stroke="#000000"');
    const scale = qrPngScale(QRCode.create(link, QR_OPTIONS).modules.size);
    const png = await QRCode.toBuffer(link, { ...QR_OPTIONS, scale, type: "png" });
    // IHDR width/height
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(QR_PNG_SIZE);
    // the largest link (32-character tags) still at least 1024 px
    for (const n of [21, 41, 57, 77]) expect(qrPngScale(n) * (n + 8)).toBeGreaterThanOrEqual(1024);
    expect(png.readUInt32BE(20)).toBe(png.readUInt32BE(16));
  });
});
