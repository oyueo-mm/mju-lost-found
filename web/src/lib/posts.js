import { KIND_CONFIG } from "@/lib/constants";

// 모든 함수는 supabase 클라이언트를 인자로 받는다 (서버/관리자 클라이언트 모두 가능).

export async function listPosts(
  supabase,
  kind,
  {
    q = "",
    category = "",
    status = "",
    campus = "",
    location = "",
    includeCompleted = false,
    sort = "newest", // "newest" | "oldest"
  } = {},
) {
  const cfg = KIND_CONFIG[kind];
  let query = supabase
    .from(cfg.table)
    .select("*, author:profiles!user_id(nickname)")
    .order("created_at", { ascending: sort === "oldest" });

  if (campus) query = query.eq("campus", campus);
  if (location) query = query.eq("location", location);
  if (category) query = query.eq("category", category);
  if (status) query = query.eq("status", status);
  // 완료된(되찾은/전달완료) 글은 목록에서 숨김
  else if (!includeCompleted) query = query.eq("status", cfg.defaultStatus);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ").trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getPost(supabase, kind, id) {
  const cfg = KIND_CONFIG[kind];
  // phase-17(명지도) 미적용 DB 폴백
  let { data, error } = await supabase
    .from(cfg.table)
    .select("*, author:profiles!user_id(nickname, trust_score)")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    ({ data, error } = await supabase
      .from(cfg.table)
      .select("*, author:profiles!user_id(nickname)")
      .eq("id", id)
      .maybeSingle());
  }
  if (error) throw error;
  return data;
}

export async function listMyPosts(supabase, kind, userId) {
  const cfg = KIND_CONFIG[kind];
  const { data, error } = await supabase
    .from(cfg.table)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listMyPostsAll(supabase, userId) {
  const [lost, found] = await Promise.all([
    listMyPosts(supabase, "lost", userId),
    listMyPosts(supabase, "found", userId),
  ]);
  return [
    ...lost.map((p) => ({ ...p, kind: "lost" })),
    ...found.map((p) => ({ ...p, kind: "found" })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// AI 매칭용 텍스트
export function buildEmbeddingText(post) {
  return [
    post.title,
    post.description,
    post.category,
    post.location,
    post.location_detail,
  ]
    .filter(Boolean)
    .join(" ");
}
