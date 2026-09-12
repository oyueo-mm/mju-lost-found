// node scripts/gen-icons.mjs — PWA 아이콘 생성 (파란 타일 + 돋보기)
import sharp from "sharp";

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#1567cf"/><stop offset="0.55" stop-color="#0b4da2"/><stop offset="1" stop-color="#08356e"/>
</linearGradient></defs>
<rect x="${pad}" y="${pad}" width="${512 - 2 * pad}" height="${512 - 2 * pad}" rx="${pad > 40 ? 90 : 112}" fill="url(#g)"/>
<g fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round">
<circle cx="228" cy="228" r="104"/><line x1="300" y1="300" x2="380" y2="380"/>
</g></svg>`;

await sharp(Buffer.from(svg(24))).png().toFile("public/icon-512.png");
await sharp(Buffer.from(svg(24))).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(Buffer.from(svg(24))).resize(180, 180).png().toFile("src/app/apple-icon.png");
await sharp(Buffer.from(svg(0))).png().toFile("public/icon-maskable.png");
console.log("icons generated");
