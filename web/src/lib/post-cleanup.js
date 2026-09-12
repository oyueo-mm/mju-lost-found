import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { KIND_CONFIG } from "@/lib/constants";

// 게시글 삭제 — 본문 행뿐 아니라 Storage 사진, 댓글, 조회 기록까지 지운다.
// comments / post_views 는 다형(post_type+post_id) 참조라 FK cascade 를 못 걸어서 여기서 처리.
// 사진은 공개 URL 로 계속 접근 가능해지는 걸 막기 위해 반드시 지운다.
//
// 삭제 권한 검사는 호출한 쪽 책임 (본인 확인 / requireAdmin). 이 함수는 service_role 로 돈다.
export async function deletePostWithAssets(kind, id) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error("bad kind");
  const admin = createAdminClient();

  const { data: post } = await admin
    .from(cfg.table)
    .select("id, image_url, image_urls")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { ok: false, notFound: true };

  // 1) 사진 — 공개 URL → 버킷 경로
  const urls = Array.isArray(post.image_urls)
    ? post.image_urls
    : post.image_url
      ? [post.image_url]
      : [];
  const paths = urls.map(storagePathFromUrl).filter(Boolean);
  if (paths.length > 0) {
    const { error } = await admin.storage.from("post-images").remove(paths);
    if (error) console.error("[post-cleanup] 사진 삭제 실패:", kind, id, error.message);
  }

  // 2) 댓글 · 조회 기록 (FK 없음)
  await admin.from("comments").delete().eq("post_type", kind).eq("post_id", id);
  await admin.from("post_views").delete().eq("post_kind", kind).eq("post_id", id);

  // 3) 본문 — chat_rooms.*_post_id / matches 는 FK 가 set null / cascade 처리
  const { error } = await admin.from(cfg.table).delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// https://<proj>.supabase.co/storage/v1/object/public/post-images/<path> → <path>
export function storagePathFromUrl(url) {
  const m = /\/object\/public\/post-images\/(.+)$/.exec(String(url || ""));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
