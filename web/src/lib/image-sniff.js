import "server-only";

// 업로드 파일의 실제 종류를 매직 바이트로 판별한다.
// 클라이언트가 보내는 file.type / 파일명 확장자는 조작 가능하므로 신뢰하지 않는다.
// 허용: JPEG · PNG · WEBP. 그 외(SVG·HTML·GIF 포함)는 null → 업로드 거부.

const SIGS = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    test: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    type: "image/webp",
    ext: "webp",
    // "RIFF" .... "WEBP"
    test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];

// File/Blob → { type, ext } 또는 null
export async function sniffImage(file) {
  if (!file || typeof file.slice !== "function") return null;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return null;
  for (const s of SIGS) if (s.test(head)) return { type: s.type, ext: s.ext };
  return null;
}
