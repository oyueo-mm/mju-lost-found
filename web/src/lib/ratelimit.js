import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 사용자·행동별 요청 제한. DB 함수 check_rate_limit (phase-33) 가 고정 창으로 센다.
//
//   const limited = await rateLimited(user.id, "post");
//   if (limited) return { error: limited };
//
// 함수가 아직 없거나(마이그레이션 전) DB 오류면 막지 않고 통과시킨다 (fail-open):
// 제한 때문에 서비스 전체가 멈추는 것보다 잠깐 제한이 풀리는 쪽이 낫다.

// [횟수, 창(초)]
const LIMITS = {
  post: [5, 10 * 60], // 게시글 등록 — 10분에 5개
  post_edit: [20, 10 * 60],
  comment: [20, 10 * 60],
  chat: [40, 60], // 채팅 메시지 — 1분에 40개
  chat_open: [20, 60 * 60], // 새 채팅방 열기
  report: [10, 60 * 60],
  inquiry: [5, 60 * 60],
  inquiry_reply: [20, 60 * 60],
  appeal: [3, 24 * 60 * 60],
  ai_search: [40, 60 * 60], // 텍스트 AI 검색 (Cloudflare 호출)
  image_search: [20, 60 * 60], // 비전 + 임베딩 호출
};

export const RATE_LIMIT_MSG = "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";

// 제한에 걸리면 사용자에게 보여줄 문자열, 아니면 null.
export async function rateLimited(userId, action) {
  const cfg = LIMITS[action];
  if (!cfg || !userId) return null;
  const [limit, windowSec] = cfg;

  try {
    const { data, error } = await createAdminClient().rpc("check_rate_limit", {
      p_user: userId,
      p_action: action,
      p_limit: limit,
      p_window_sec: windowSec,
    });
    if (error) {
      console.error("[ratelimit] rpc 실패 — 통과시킴:", action, error.message);
      return null;
    }
    return data === false ? RATE_LIMIT_MSG : null;
  } catch (e) {
    console.error("[ratelimit] 예외 — 통과시킴:", action, e?.message);
    return null;
  }
}
