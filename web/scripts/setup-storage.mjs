// 실행: node --env-file=.env.local scripts/setup-storage.mjs
// 게시글 사진 저장용 Storage 버킷을 만든다 (한 번만).
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } = await supabase.storage.createBucket("post-images", {
  public: true,
  fileSizeLimit: 5 * 1024 * 1024,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
});

if (error && !/already exists/i.test(error.message)) {
  console.error("버킷 생성 실패:", error.message);
  process.exit(1);
}
console.log("post-images 버킷 준비 완료", data ?? "(이미 존재)");
