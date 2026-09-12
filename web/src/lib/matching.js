import { KIND_CONFIG } from "@/lib/constants";

function toVec(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  try {
    const p = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// 정규화된 벡터끼리라 내적 == 코사인 유사도
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// bge-m3 는 무관한 한국어끼리도 ~0.4 가 나온다. 0.35 이하 0, 0.70 이상 1 로 펴서 쓴다.
export function spreadSemantic(sem) {
  return Math.max(0, Math.min(1, (sem - 0.35) / 0.35));
}

// bge-reranker-base 실측(한국어 분실물): 무관 <0.01, 애매 0.15, 진짜 0.4~0.6.
// 0.05 이하 0, 0.60 이상 1 로 펴서 쓴다.
export function calibrateRerank(r) {
  return Math.max(0, Math.min(1, (r - 0.05) / 0.55));
}

// 재정렬(변별력) 6 : 코사인(안정성) 4 융합. 재정렬 원점수가 거의 0 이면 무관으로 확정.
export function fuseScores(rerankRaw, sim) {
  if (rerankRaw < 0.02) return 0;
  return 0.6 * calibrateRerank(rerankRaw) + 0.4 * spreadSemantic(sim);
}

// 매칭용 텍스트 (게시글 → 한 문장). posts.js 의 buildEmbeddingText 와 같은 필드.
export function matchText(post) {
  return [post.title, post.description, post.category, post.location, post.location_detail]
    .filter(Boolean)
    .join(" ");
}

// ── 규칙 점수 ────────────────────────────────────────────────────────────
// base(의미 점수 0~1)에 카테고리·장소·시간을 더하고 뺀다. 다르면 "감점" — 같은 캠퍼스에서
// 장소·종류가 다르면 같은 물건일 가능성이 확 떨어지기 때문.
function applyRules(base, target, targetKind, c) {
  const cfg = KIND_CONFIG[targetKind];
  const oppCfg = KIND_CONFIG[cfg.opposite];
  let score = base;
  const reasons = [];
  const warnings = [];

  if (c.category && target.category) {
    if (c.category === target.category) {
      score += 0.08;
      reasons.push("같은 카테고리");
    } else if (c.category !== "기타" && target.category !== "기타") {
      score -= 0.15;
      warnings.push("다른 카테고리");
    }
  }

  const locA = (c.location || "").trim();
  const locB = (target.location || "").trim();
  if (locA && locB && locA !== "기타" && locB !== "기타") {
    if (locA === locB) {
      score += 0.07;
      reasons.push("같은 장소");
    } else {
      score -= 0.1;
      warnings.push("다른 장소");
    }
  }

  const targetDate = new Date(target[cfg.dateField]);
  const candDate = new Date(c[oppCfg.dateField]);
  const lostDate = targetKind === "lost" ? targetDate : candDate;
  const foundDate = targetKind === "lost" ? candDate : targetDate;
  const gapDays = (foundDate - lostDate) / 86400000;
  if (Number.isFinite(gapDays)) {
    if (gapDays >= -1 && gapDays <= 30) {
      score += 0.05;
      reasons.push("시간대 일치");
    } else if (gapDays < -3) {
      score -= 0.25; // 잃어버리기 전에 주웠다면 다른 물건
      warnings.push("시간 순서 안 맞음");
    }
  }

  return { score: Math.max(0, Math.min(1, score)), reasons, warnings };
}

// 코사인만 쓰는 빠른 버전 (동기). 재정렬 실패 시 폴백 + 후보 추리기용.
export function rankMatches(
  target,
  targetKind,
  candidates,
  { limit = 3, minScore = 0.55 } = {},
) {
  const targetVec = toVec(target?.embedding);
  if (!targetVec) return [];

  return (candidates || [])
    .map((c) => {
      const vec = toVec(c.embedding);
      if (!vec) return null;
      const sem = cosine(targetVec, vec);
      const r = applyRules(spreadSemantic(sem), target, targetKind, c);
      return { post: c, semantic: sem, ...r };
    })
    .filter((x) => x && x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// 까다로운 버전 (비동기): 코사인으로 상위 N 후보 → cross-encoder 재정렬 → 규칙 가감.
// 재정렬기가 죽으면 rankMatches 결과를 그대로 낸다.
export async function rankMatchesStrict(
  target,
  targetKind,
  candidates,
  { limit = 3, minScore = 0.6, prefilter = 30 } = {},
) {
  const targetVec = toVec(target?.embedding);
  if (!targetVec) return [];

  // 1) 코사인으로 후보 추리기 (API 호출 수 절약)
  const pre = (candidates || [])
    .map((c) => {
      const vec = toVec(c.embedding);
      return vec ? { post: c, semantic: cosine(targetVec, vec) } : null;
    })
    .filter((x) => x && x.semantic >= 0.38)
    .sort((a, b) => b.semantic - a.semantic)
    .slice(0, prefilter);
  if (pre.length === 0) return [];

  // 2) 재정렬
  const { rerank } = await import("@/lib/rerank");
  const scores = await rerank(
    matchText(target),
    pre.map((x) => matchText(x.post)),
  );
  if (!scores) return rankMatches(target, targetKind, candidates, { limit, minScore });

  const byIndex = new Map(scores.map((s) => [s.index, s.score]));

  // 3) 융합 + 규칙 가감
  return pre
    .map((x, i) => {
      const r = byIndex.get(i) ?? 0;
      const rules = applyRules(fuseScores(r, x.semantic), target, targetKind, x.post);
      return { post: x.post, semantic: x.semantic, rerank: r, ...rules };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
