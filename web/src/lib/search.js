import { embedText } from "@/lib/embedding";
import { rerank } from "@/lib/rerank";
import { cosine, matchText, fuseScores } from "@/lib/matching";
import { KIND_CONFIG } from "@/lib/constants";

function boardsToTables(board) {
  if (board === "lost") return [["lost_posts", "lost"]];
  if (board === "found") return [["found_posts", "found"]];
  return [
    ["lost_posts", "lost"],
    ["found_posts", "found"],
  ];
}

const SELECT = "*, author:profiles!user_id(nickname)";
const RERANK_POOL = 40; // 재정렬에 넘길 후보 수
const MIN_SCORE = 0.3; // 융합 점수 이 밑이면 "무관"

function safeParse(s) {
  if (Array.isArray(s)) return s;
  try {
    const p = JSON.parse(s);
    return Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// 코사인만 있을 때(재정렬 실패) 0~100% 매핑. bge-m3 무관 ~0.35, 좋은 매칭 ~0.7
export function relevancePct(sim, keyword) {
  const spread = Math.max(0, Math.min(1, (sim - 0.35) / 0.35));
  const v = keyword ? Math.max(spread, 0.82) : spread;
  return Math.round(v * 100);
}

// 통합 검색: 키워드 부분일치 + 임베딩으로 후보를 모은 뒤 cross-encoder 로 재정렬.
// 키워드가 정확히 들어간 글은 재정렬 점수가 낮아도 60% 바닥을 보장한다.
export async function search(supabase, { q, board, campus }) {
  const query = (q || "").trim();
  if (!query) return [];

  const safe = query.replace(/[%,()]/g, " ").trim();

  let queryVec = null;
  try {
    queryVec = await embedText(query);
  } catch {
    queryVec = null;
  }

  const pool = [];
  for (const [table, kind] of boardsToTables(board)) {
    let req = supabase
      .from(table)
      .select(SELECT)
      .eq("status", KIND_CONFIG[kind].defaultStatus)
      .limit(400);
    if (campus) req = req.eq("campus", campus);
    const { data } = await req;

    for (const post of data || []) {
      const hay = matchText(post);
      const keyword = safe && hay.toLowerCase().includes(safe.toLowerCase());

      let sim = 0;
      if (queryVec && post.embedding) {
        const v = safeParse(post.embedding);
        if (v) sim = cosine(queryVec, v);
      }
      if (keyword || sim >= 0.4) {
        pool.push({ kind, post, keyword, sim, pre: (keyword ? 0.5 : 0) + sim });
      }
    }
  }
  if (pool.length === 0) return [];

  pool.sort((a, b) => b.pre - a.pre);
  const top = pool.slice(0, RERANK_POOL);

  const scores = await rerank(query, top.map((x) => matchText(x.post)));

  if (!scores) {
    // 폴백: 예전 방식
    return top
      .map((x) => ({
        ...x,
        score: (x.keyword ? 0.5 : 0) + x.sim * 0.6,
        pct: relevancePct(x.sim, x.keyword),
      }))
      .sort((a, b) => b.score - a.score);
  }

  const byIndex = new Map(scores.map((s) => [s.index, s.score]));
  return top
    .map((x, i) => {
      const r = byIndex.get(i) ?? 0;
      const fused = fuseScores(r, x.sim);
      const score = x.keyword ? Math.max(fused, 0.6) : fused;
      return { ...x, rerank: r, score, pct: Math.round(score * 100) };
    })
    .filter((x) => x.keyword || x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

// 이미지 검색용 (비전 모델이 만든 설명 문자열 → 의미검색 → 재정렬)
export async function semanticOnly(supabase, { q, board, campus }) {
  const query = (q || "").trim();
  if (!query) return [];
  let queryVec;
  try {
    queryVec = await embedText(query);
  } catch {
    return { error: "AI 검색을 사용할 수 없어요." };
  }
  if (!queryVec) return [];

  const pool = [];
  for (const [table, kind] of boardsToTables(board)) {
    let req = supabase
      .from(table)
      .select(SELECT)
      .eq("status", KIND_CONFIG[kind].defaultStatus)
      .not("embedding", "is", null)
      .limit(500);
    if (campus) req = req.eq("campus", campus);
    const { data } = await req;
    (data || []).forEach((post) => {
      const v = safeParse(post.embedding);
      if (!v) return;
      const sim = cosine(queryVec, v);
      if (sim >= 0.38) pool.push({ kind, post, sim });
    });
  }
  if (pool.length === 0) return [];

  pool.sort((a, b) => b.sim - a.sim);
  const top = pool.slice(0, RERANK_POOL);

  const scores = await rerank(query, top.map((x) => matchText(x.post)));

  if (!scores) {
    return top
      .filter((x) => x.sim >= 0.42)
      .map((x) => ({ ...x, score: x.sim, pct: relevancePct(x.sim, false) }))
      .slice(0, 24);
  }

  const byIndex = new Map(scores.map((s) => [s.index, s.score]));
  return top
    .map((x, i) => {
      const r = byIndex.get(i) ?? 0;
      const score = fuseScores(r, x.sim);
      return { ...x, rerank: r, score, pct: Math.round(score * 100) };
    })
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
}
