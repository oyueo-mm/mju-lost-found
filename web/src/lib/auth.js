import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasAgreedToTerms } from "@/lib/legal";
import { getBetaOpen } from "@/lib/settings";

// 설정된 도메인 전체 (mju + 베타 도메인). 상시 허용은 mju.ac.kr 뿐.
const CONFIGURED_DOMAINS = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS || "mju.ac.kr,gmail.com"
)
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const PERMANENT_DOMAINS = ["mju.ac.kr"];

function domainOf(email) {
  return typeof email === "string" ? email.toLowerCase().split("@")[1] : null;
}

// 동기 검사: 설정 목록에 있는 도메인인가 (베타 토글 무시 — 화면 표시용)
export function isAllowedEmail(email) {
  const d = domainOf(email);
  return !!d && CONFIGURED_DOMAINS.includes(d);
}

// 실제 로그인 허용 여부: mju 는 항상, 베타 도메인은 app_settings.beta_open 일 때만.
export async function isEmailPermitted(email) {
  const d = domainOf(email);
  if (!d || !CONFIGURED_DOMAINS.includes(d)) return false;
  if (PERMANENT_DOMAINS.includes(d)) return true;
  return await getBetaOpen();
}

export const SUSPENDED_MSG = "정지된 계정은 이 기능을 사용할 수 없어요.";

export function isSuspended(profile) {
  if (!profile?.is_suspended) return false;
  if (!profile.suspended_until) return true; // 영구 정지
  return new Date(profile.suspended_until).getTime() > Date.now();
}

// 본인 프로필 전체(이메일·전공·정지 정보 포함).
// profiles 는 authenticated 에게 id/nickname/trust_score/created_at 컬럼만 열려 있어서
// (phase-32) 나머지는 service_role 로만 읽는다. userId 는 검증된 JWT 에서 온 값만 넣을 것.
export async function getOwnProfile(userId) {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

// 현재 로그인한 유저 + profiles 행. 비로그인이면 null.
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await getOwnProfile(user.id);
  return { user, profile, supabase };
}

// 로그인 필수 페이지·액션. 닉네임·약관동의는 예외 없이 강제한다.
// mustBeActive: 정지 계정이면 /suspended 로.
export async function requireUser({ needNickname = true, mustBeActive = false } = {}) {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (!(await isEmailPermitted(session.user.email)))
    redirect("/login?error=domain");
  if (needNickname) {
    if (!session.profile?.nickname) redirect("/onboarding");
    // 정지 계정은 /suspended 안내가 우선 (약관 동의를 물을 이유 없음)
    if (isSuspended(session.profile)) redirect("/suspended");
    if (!hasAgreedToTerms(session.profile)) redirect("/consent");
  }
  if (mustBeActive && isSuspended(session.profile)) redirect("/suspended");
  return session;
}

// 권한은 총관리자(owner) / 관리자(admin) / 일반(user).
// owner 는 관리자 기능을 모두 쓰되, 다른 관리자가 강등·정지·삭제할 수 없다(팀킬 방지 백스톱).
export function roleOf(profile) {
  if (profile?.role === "admin" || profile?.role === "user") return profile.role;
  if (profile?.role === "owner") return "admin"; // 스태프 판정은 admin 과 동일
  return profile?.is_admin ? "admin" : "user";
}
export function isOwner(profile) {
  return profile?.role === "owner";
}
export function isStaff(profile) {
  return roleOf(profile) === "admin";
}

// 관리자 전용.
export async function requireAdmin() {
  const session = await requireUser();
  if (!isStaff(session.profile)) redirect("/");
  return session;
}
