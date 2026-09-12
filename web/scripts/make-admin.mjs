// 실행: node --env-file=.env.local scripts/make-admin.mjs <이메일>
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!email) {
  console.error("사용법: node --env-file=.env.local scripts/make-admin.mjs you@mju.ac.kr");
  process.exit(1);
}

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data, error } = await s
  .from("profiles")
  .update({ is_admin: true, role: "admin" })
  .eq("email", email)
  .select("email, nickname, role, is_admin");

if (error) console.error("실패:", error.message);
else if (!data?.length) console.error("해당 이메일의 프로필이 없어요. 먼저 로그인 한 번 해야 함.");
else console.log("관리자 지정 완료:", data[0]);
