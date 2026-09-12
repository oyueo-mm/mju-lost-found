import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 업로드 파일 정리 (best-effort). 게시글 이미지 = "<uid>/", 채팅 이미지 = "chat/<uid>/".
async function purgeUserStorage(admin, userId) {
  for (const prefix of [userId, `chat/${userId}`]) {
    try {
      const { data: files } = await admin.storage
        .from("post-images")
        .list(prefix, { limit: 1000 });
      if (files && files.length > 0) {
        await admin.storage
          .from("post-images")
          .remove(files.map((f) => `${prefix}/${f.name}`));
      }
    } catch {
      /* 파일 없음 등 — 무시 */
    }
  }
}

// 계정을 완전히 삭제한다. auth.users 삭제 → profiles 및 대부분의 하위 데이터
// (게시글·댓글·채팅방·메시지·신고·알림·매칭·문의) 가 FK cascade 로 함께 삭제된다.
export async function hardDeleteUser(userId) {
  const admin = createAdminClient();
  await purgeUserStorage(admin, userId);

  // profiles(id) 를 non-cascade 로 참조하는 컬럼들 — 안 비우면 FK 위반으로 삭제 실패.
  // (주로 관리자 활동 흔적: 신고 처리자, 설정 변경자)
  await admin
    .from("reports")
    .update({ resolved_by: null })
    .eq("resolved_by", userId);
  await admin
    .from("app_settings")
    .update({ updated_by: null })
    .eq("updated_by", userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
