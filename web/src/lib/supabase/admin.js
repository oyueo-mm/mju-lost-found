import { createClient } from "@supabase/supabase-js";

// 서버 전용. RLS 를 우회하는 관리자 권한 클라이언트.
// 매칭 저장 / 관리자 기능 등 "서버가 대신 처리해야 하는" 작업에만 사용.
// 절대 클라이언트 컴포넌트에서 import 하지 말 것.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
