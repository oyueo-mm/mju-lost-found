import type { QrRegistryEntry } from "./qrRegistry";
import { QR_OPTIONS, qrPngScale } from "./utmLink";

export type QrFormat = "png" | "svg";
export async function qrSvg(url: string): Promise<string> {
  const QR = await import("qrcode");
  return QR.toString(url, { ...QR_OPTIONS, type: "svg" });
}
export async function qrImage(url: string, format: QrFormat): Promise<Uint8Array> {
  if (format === "svg") return new TextEncoder().encode(await qrSvg(url));
  const QR = await import("qrcode");
  const scale = qrPngScale(QR.create(url, QR_OPTIONS).modules.size);
  const data = await QR.toDataURL(url, { ...QR_OPTIONS, scale, type: "image/png" });
  return Uint8Array.from(atob(data.slice(data.indexOf(",") + 1)), (c) => c.charCodeAt(0));
}
export function registeredQrFileName(entry: QrRegistryEntry, format: QrFormat): string {
  if (!/^[a-z0-9_-]{1,32}$/.test(entry.utm_content)) throw new Error("Invalid registered QR filename");
  return `${entry.utm_content}.${format}`;
}
export async function qrArchive(entries: readonly QrRegistryEntry[], format: QrFormat): Promise<Uint8Array> {
  if (!entries.length) throw new Error("No QR codes to download");
  const names = entries.map((entry) => registeredQrFileName(entry, format));
  if (new Set(names).size !== names.length) throw new Error("Duplicate QR filenames");
  const images = await Promise.all(entries.map((entry) => qrImage(entry.url, format)));
  const files = Object.fromEntries(names.map((name, i) => [name, images[i]]));
  files["qr-links.json"] = new TextEncoder().encode(JSON.stringify(entries.map((entry, i) => ({ file: names[i], qr_id: entry.qr_id, campaign: entry.utm_campaign, content: entry.utm_content, url: entry.url })), null, 2));
  const { zipSync } = await import("fflate");
  return zipSync(files, { level: 0 });
}

export function saveQrBytes(name: string, bytes: Uint8Array, type: string) {
  const href = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const anchor = document.createElement("a");
  anchor.href = href; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
