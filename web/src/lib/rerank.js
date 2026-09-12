import "server-only";
import { cfRun } from "@/lib/embedding";

// Cross-encoder 재정렬 — Cloudflare Workers AI bge-reranker-base (무료).
// 임베딩 코사인은 "대충 비슷한" 것까지 0.5 근처로 몰리지만, 재정렬기는
// 질문과 문서를 한 쌍으로 같이 읽어서 무관 0.0x / 같은 물건 0.9+ 로 확실히 가른다.
//
// 반환: [{ index, score }] (score 내림차순). 실패하면 null → 호출 쪽이 코사인으로 폴백.
const MODEL = "@cf/baai/bge-reranker-base";
const MAX_CONTEXTS = 40;

export async function rerank(query, texts) {
  const q = (query || "").replace(/\s+/g, " ").trim();
  const contexts = (texts || []).slice(0, MAX_CONTEXTS).map((t) => ({
    text: String(t || "").replace(/\s+/g, " ").trim().slice(0, 1000) || "-",
  }));
  if (!q || contexts.length === 0) return [];

  try {
    const json = await cfRun(MODEL, { query: q, contexts, top_k: contexts.length }, 20000);
    const rows = json?.result?.response;
    if (!Array.isArray(rows)) return null;
    return rows
      .map((r) => ({ index: Number(r.id), score: clamp01(Number(r.score)) }))
      .filter((r) => Number.isInteger(r.index) && r.index >= 0 && r.index < contexts.length)
      .sort((a, b) => b.score - a.score);
  } catch (e) {
    console.error("[rerank] 실패:", e?.message);
    return null;
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
