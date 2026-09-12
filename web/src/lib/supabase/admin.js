import "server-only";
import { createClient } from "@supabase/supabase-js";

// 서버 전용. RLS 를 우회하는 관리자 권한 클라이언트.
// 매칭 저장 / 관리자 기능 등 "서버가 대신 처리해야 하는" 작업에만 사용.
// 클라이언트 컴포넌트에서 import 하면 위 "server-only" 가 빌드를 실패시킨다
// (service_role 키가 브라우저 번들에 들어가는 사고 방지).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
