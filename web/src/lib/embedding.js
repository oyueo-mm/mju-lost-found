import "server-only";
import { KIND_CONFIG } from "@/lib/constants";
import { buildEmbeddingText } from "@/lib/posts";
import { createAdminClient } from "@/lib/supabase/admin";

// AI 매칭 임베딩 — Cloudflare Workers AI 의 bge-m3 (다국어 1024차원).
// 외부 API 호출 1번이라 서버 배포가 가볍고 빠르다.
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const MODEL = "@cf/baai/bge-m3";

function l2normalize(v) {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function cfRun(model, body, timeoutMs = 30000) {
  if (!ACCOUNT_ID || !API_TOKEN) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN 환경변수가 없습니다.");
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!res.ok) throw new Error(`Cloudflare AI 응답 오류 ${res.status}`);
  return res.json();
}

export async function embedText(text) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const json = await cfRun(MODEL, { text: [clean] });
  const vec = json?.result?.data?.[0];
  if (!Array.isArray(vec)) throw new Error("임베딩 응답 형식 오류");
  return l2normalize(vec);
}

// 이미지(바이트 배열) → 한국어 검색 키워드 구. 이미지 기반 검색용.
export async function describeImage(bytes) {
  const json = await cfRun(
    "@cf/meta/llama-3.2-11b-vision-instruct",
    {
      image: Array.from(bytes),
      prompt:
        "이미지에서 가장 중심에 있는 물건 1개를 한국어 검색 키워드로만 묘사해. " +
        "완성된 문장이나 '~입니다', '종류는', '브랜드는' 같은 라벨을 쓰지 말고, " +
        "쉼표로 구분된 짧은 단어·구만 나열해. 순서는 색상, 물건 이름, 눈에 띄는 특징. " +
        "이미지에 글자나 로고가 또렷하게 보일 때만 브랜드를 적고, 안 보이면 브랜드는 쓰지 마(추측 금지). " +
        "마크다운(**, #)이나 번호를 쓰지 마. 최대 10단어. " +
        "예시: '검정 가죽 장지갑, 지퍼, 카드칸 많음' 또는 '흰색 텀블러, 500ml, 손잡이'. " +
        "사람·손·책상·배경은 무시.",
      max_tokens: 64,
      temperature: 0.2,
    },
    40000,
  );
  const text = json?.result?.response?.trim();
  const cleaned = cleanImageDescription(text);
  if (cleaned) return cleaned;
  // 정리 후 남는 게 없으면 마크다운만 걷어낸 원문으로 대체
  return text
    ? text.replace(/[*`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120) || null
    : null;
}

// 비전 모델이 문장·마크다운·라벨을 섞어 뱉는 걸 검색용 키워드 구로 정리
const DESC_PREFIX =
  /^\s*['"‘’“”]?\s*(이|그|해당)?\s*사진\s*(속|안|에)?\s*(에\s*(있는|찍힌))?\s*['"‘’“”]?\s*(물건|사물|이미지|물체)\s*['"‘’“”]?\s*(은|는|이|가)?\s*[:：]?\s*/;
const DESC_LABELS =
  /(색상|색깔|컬러|종류|유형|분류|타입|브랜드|상표|제조사|메이커|특징|특성|외형|크기|사이즈|길이|높이|너비|재질|소재)\s*(은|는|이|가)?\s*[:：]?\s*/g;
const DESC_SENT_END =
  /\s*(입니다|이에요|예요|이다|입니당|이네요|같습니다|같아요|보입니다|보여요|나옵니다|나와요|나온다|있습니다|있어요)\s*[.。!?]*/g;
const DESC_JUNK =
  /^(그것|이것|물건|사물|아이템|제품|물체|사진|이미지|배경|사람|손|없음|불명|모름)$|이런\s*식|이렇게|그런\s*식|저런\s*식/;

function cleanImageDescription(raw) {
  const s = String(raw || "")
    .replace(/[*`#>_~|[\]]+/g, " ")
    .replace(DESC_PREFIX, "")
    .replace(DESC_SENT_END, ", ")
    .replace(DESC_LABELS, "")
    .replace(/[\n·•‣▪]+/g, ", ")
    .replace(/[.。!?]+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  const kept = [];
  for (let part of s.split(",")) {
    part = part
      .trim()
      .replace(/^(그리고|또한|그|이|저)\s+/, "")
      .replace(/\s*(으로|로)$/, "");
    if (part.length < 2 || DESC_JUNK.test(part)) continue;
    const key = part.replace(/\s/g, "");
    if (kept.some((k) => k.replace(/\s/g, "").includes(key))) continue;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (key.includes(kept[i].replace(/\s/g, ""))) kept.splice(i, 1);
    }
    kept.push(part);
  }
  const out = kept.join(", ").slice(0, 160).replace(/[,\s]+$/, "");
  return out || null;
}

// 게시글 하나의 임베딩을 계산해 저장하고, 반대 게시판에 강한 매칭이 있으면 알림.
export async function embedPostById(kind, id) {
  try {
    const cfg = KIND_CONFIG[kind];
    if (!cfg) return;
    const admin = createAdminClient();

    const { data: post } = await admin
      .from(cfg.table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!post) return;

    const vec = await embedText(buildEmbeddingText(post));
    if (!vec) return;

    await admin.from(cfg.table).update({ embedding: vec }).eq("id", id);
    await notifyStrongMatches(admin, { ...post, embedding: vec }, kind);
  } catch (e) {
    console.error("[embedding] 실패:", kind, id, e?.message);
  }
}

// 새 게시글과 강하게(85%+) 맞는 반대 게시판 글이 있으면 양쪽에 알림.
async function notifyStrongMatches(admin, post, kind) {
  try {
    const { KIND_CONFIG: KC } = await import("@/lib/constants");
    const { rankMatchesStrict } = await import("@/lib/matching");
    const { createNotification } = await import("@/lib/notifications");
    const oppCfg = KC[KC[kind].opposite];

    let cq = admin
      .from(oppCfg.table)
      .select("*, author:profiles!user_id(nickname)")
      .eq("status", oppCfg.defaultStatus)
      .not("embedding", "is", null)
      .limit(300);
    if (post.campus) cq = cq.eq("campus", post.campus);
    const { data: candidates } = await cq;

    // 재정렬 + 규칙 가감 후 85% 이상만 알림 (오탐 방지)
    const top = (
      await rankMatchesStrict(post, kind, candidates || [], {
        limit: 1,
        minScore: 0.85,
      })
    )[0];
    if (!top) return;

    const otherKind = oppCfg.kind;
    const pct = Math.round(top.score * 100);

    await createNotification(
      post.user_id,
      "match",
      `AI가 ${pct}% 일치하는 ${oppCfg.label} 게시글을 찾았어요`,
      `"${top.post.title}" — 지금 확인해 보세요.`,
      `/${otherKind}/${top.post.id}`,
    );
    if (top.post.user_id && top.post.user_id !== post.user_id) {
      await createNotification(
        top.post.user_id,
        "match",
        `AI가 ${pct}% 일치하는 ${KC[kind].label} 게시글을 찾았어요`,
        `"${post.title}" — 지금 확인해 보세요.`,
        `/${kind}/${post.id}`,
      );
    }
  } catch (e) {
    console.error("[auto-match] 실패:", e?.message);
  }
}
