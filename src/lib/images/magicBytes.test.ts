import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MAGIC_BYTES_NEEDED, sniffBlobImageType, sniffImageType } from "./magicBytes";

const enc = (s: string) => new TextEncoder().encode(s);
const real = async (format: "jpeg" | "png" | "webp" | "gif" | "tiff" | "avif") =>
  new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#c33" } }).toFormat(format).toBuffer());

describe("sniffImageType (release B, H-3)", () => {
  it("recognises real JPEG, PNG and WebP files by their own bytes", async () => {
    expect(sniffImageType(await real("jpeg"))).toBe("image/jpeg");
    expect(sniffImageType(await real("png"))).toBe("image/png");
    expect(sniffImageType(await real("webp"))).toBe("image/webp");
  });

  it("rejects every other real image format a native decoder would accept", async () => {
    expect(sniffImageType(await real("gif"))).toBeNull();
    expect(sniffImageType(await real("tiff"))).toBeNull();
    expect(sniffImageType(await real("avif"))).toBeNull(); // HEIF container (ftyp)
    expect(sniffImageType(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0]))).toBeNull(); // ftypheic
    expect(sniffImageType(enc("BM\x00\x00\x00\x00\x00\x00\x00\x00\x36\x00"))).toBeNull(); // BMP
  });

  it("rejects SVG and other text, including SVG starting with whitespace or an XML prolog", () => {
    expect(sniffImageType(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(enc('  \n<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(sniffImageType(enc("<html><script>alert(1)</script></html>"))).toBeNull();
  });

  it("rejects truncated or empty data and look-alike containers", () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull(); // shorter than the bytes needed
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00, 0, 0, 0, 0]))).toBeNull(); // broken PNG signature
    expect(sniffImageType(enc("RIFF\x24\x00\x00\x00WAVEfmt "))).toBeNull(); // RIFF but a WAV file
    expect(MAGIC_BYTES_NEEDED).toBe(12);
  });

  it("goes by the first bytes, so a file mixing formats is classified by its real header", async () => {
    const png = await real("png");
    const svgThenPng = new Uint8Array([...enc("<svg>"), ...png]);
    expect(sniffImageType(svgThenPng)).toBeNull();
    const pngThenSvg = new Uint8Array([...png, ...enc("<svg onload=alert(1)>")]);
    expect(sniffImageType(pngThenSvg)).toBe("image/png"); // still decoded as PNG by sharp, never as SVG
  });

  it("reads a Blob's first bytes and ignores its declared type", async () => {
    expect(await sniffBlobImageType(new Blob([enc("<svg/>")], { type: "image/png" }))).toBeNull();
    expect(await sniffBlobImageType(new Blob([await real("webp")], { type: "image/jpeg" }))).toBe("image/webp");
  });
});
