"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { setBetaOpen } from "@/lib/settings";
import { hardDeleteUser } from "@/lib/account-delete";

// ── 신고 처리 ────────────────────────────────────────────────
// action: "resolve" | "dismiss" | "delete_target" | "suspend_author"
// 기각(dismiss)이 아니면 = 신고 인용 → 대상 사용자 명지도 -3%p
const REPORT_TRUST_PENALTY = 3;

// 신고 대상이 누구(사용자)인지 찾는다
async function reportOffenderId(admin, report) {
  if (report.target_type === "user") return report.target_id;
  if (report.target_type === "message") {
    const { data } = await admin
      .from("messages")
      .select("sender_id")
      .eq("id", report.target_id)
      .maybeSingle();
    return data?.sender_id || null;
  }
  const table =
    report.target_type === "lost_post"
      ? "lost_posts"
      : report.target_type === "found_post"
        ? "found_posts"
        : null;
  if (!table) return null;
  const { data } = await admin
    .from(table)
    .select("user_id")
    .eq("id", report.target_id)
    .maybeSingle();
  return data?.user_id || null;
}

export async function handleReport(reportId, action) {
  const { user } = await requireAdmin();
  const admin = createAdminClient();

  const { data: report } = await admin
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return { error: "신고를 찾을 수 없어요." };
  if (report.status !== "pending") {
    return { error: "이미 처리된 신고예요." };
  }

  const postTable =
    report.target_type === "lost_post"
      ? "lost_posts"
      : report.target_type === "found_post"
        ? "found_posts"
        : null;

  const upheld = action !== "dismiss";
  // 대상 삭제 전에 신고 대상 사용자를 먼저 확보
  const offenderId = upheld ? await reportOffenderId(admin, report) : null;

  if (action === "delete_target") {
    if (postTable) {
      await admin.from(postTable).delete().eq("id", report.target_id);
    } else if (report.target_type === "message") {
      // 내용은 보존하고 숨김 처리만 (감사 목적)
      await admin
        .from("messages")
        .update({ hidden_at: new Date().toISOString() })
        .eq("id", report.target_id);
    }
  } else if (action === "suspend_author" && offenderId) {
    const { data: off } = await admin
      .from("profiles")
      .select("role, is_admin")
      .eq("id", offenderId)
      .maybeSingle();
    if (off?.role === "owner" || off?.role === "admin" || off?.is_admin) {
      return { error: "관리자 계정은 정지할 수 없어요." };
    }
    await suspend(admin, offenderId, 7, user.id, report.reason || null);
  }

  // 신고 인용 → 명지도 감점 + 통지
  if (upheld && offenderId) {
    try {
      await admin.rpc("adjust_trust", {
        p_user: offenderId,
        p_delta: -REPORT_TRUST_PENALTY,
      });
      await createNotification(
        offenderId,
        "report_processed",
        "신고가 확인되었어요",
        `커뮤니티 규정 위반으로 명지도가 ${REPORT_TRUST_PENALTY}%p 내려갔어요.`,
        null,
      );
    } catch {
      /* adjust_trust 함수가 아직 없으면 무시 */
    }
  }

  await admin
    .from("reports")
    .update({
      status: action === "dismiss" ? "dismissed" : "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", reportId);

  revalidatePath("/admin/reports");
  return { ok: true };
}

// ── 신고 대화 열람 동의 (관리자 전원 동의해야 열림) ──────────
export async function approveTranscript(reportId) {
  const { user } = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin
    .from("report_transcript_approvals")
    .insert({ report_id: reportId, admin_id: user.id });
  if (error && error.code !== "23505") {
    return { error: "동의 처리에 실패했어요." };
  }

  // 아직 동의 안 한 관리자에게 알림
  const [{ data: staff }, { data: appr }] = await Promise.all([
    admin.from("profiles").select("id").eq("role", "admin"),
    admin
      .from("report_transcript_approvals")
      .select("admin_id")
      .eq("report_id", reportId),
  ]);
  const approvedIds = new Set((appr || []).map((a) => a.admin_id));
  for (const s of staff || []) {
    if (!approvedIds.has(s.id)) {
      await createNotification(
        s.id,
        "report_processed",
        "신고 대화 열람 동의 요청",
        `신고 #${reportId}의 채팅 내용 열람에 다른 관리자가 동의했어요. 확인해 주세요.`,
        `/admin/reports/${reportId}`,
      );
    }
  }
  revalidatePath(`/admin/reports/${reportId}`);
  return { ok: true };
}

// ── 게시글 강제 삭제 ─────────────────────────────────────────
export async function adminDeletePost(kind, id) {
  await requireAdmin();
  const table = kind === "lost" ? "lost_posts" : "found_posts";
  const admin = createAdminClient();
  const { error } = await admin.from(table).delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };
  revalidatePath("/admin/posts");
  revalidatePath(`/${kind}`);
  return { ok: true };
}

// ── 사용자 정지 / 해제 ───────────────────────────────────────
async function suspend(admin, userId, days, byUserId, reason = null) {
  const until =
    days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  await admin
    .from("profiles")
    .update({
      is_suspended: true,
      suspended_until: until,
      suspension_reason: reason,
      // 새 제재 → 이전 이의 제기 내역 정리
      appeal_text: null,
      appeal_at: null,
    })
    .eq("id", userId);

  const period = days > 0 ? `${days}일간 이용이 제한돼요.` : "영구 정지예요.";
  await createNotification(
    userId,
    "report_processed",
    "계정이 정지되었습니다",
    reason ? `${period} 사유: ${reason}` : period,
    "/suspended",
  );
}

// days > 0 → 기간 정지, days === 0 → 영구 정지. 해제는 liftSuspension.
export async function setUserSuspension(userId, days, reason) {
  const { user } = await requireAdmin();
  if (userId === user.id) return { error: "본인은 정지할 수 없어요." };

  const n = Number(days);
  if (!Number.isFinite(n) || n < 0) return { error: "잘못된 기간이에요." };
  const clean = (reason || "").toString().trim().slice(0, 200) || null;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("role, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (target?.role === "owner") {
    return { error: "총관리자 계정은 정지할 수 없어요." };
  }
  if (target?.role === "admin" || target?.is_admin) {
    return { error: "관리자 계정은 정지할 수 없어요. 먼저 '관리자 해제' 하세요." };
  }

  await suspend(admin, userId, n, user.id, clean);
  revalidatePath("/admin/users");
  return { ok: true };
}

export async function liftSuspension(userId) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({
      is_suspended: false,
      suspended_until: null,
      suspension_reason: null,
      appeal_text: null,
      appeal_at: null,
    })
    .eq("id", userId);
  revalidatePath("/admin/users");
  return { ok: true };
}

// ── 전체 공지 ────────────────────────────────────────────────
export async function sendNotice(_prev, formData) {
  const { user } = await requireAdmin();
  const title = (formData.get("title") || "").toString().trim();
  const body = (formData.get("body") || "").toString().trim();
  const linkRaw = (formData.get("link") || "").toString().trim();
  const link = linkRaw || null;

  if (title.length < 2) return { error: "제목을 입력해 주세요." };
  if (title.length > 100) return { error: "제목은 100자 이내로 적어주세요." };
  if (body.length > 1000) return { error: "내용은 1000자 이내로 적어주세요." };
  if (link && !link.startsWith("/")) {
    return { error: "링크는 / 로 시작하는 앱 내부 경로만 넣을 수 있어요." };
  }

  const admin = createAdminClient();
  const { data: users } = await admin.from("profiles").select("id");
  const ids = (users || []).map((u) => u.id);
  if (ids.length === 0) return { error: "받을 사용자가 없어요." };

  // 공지 먼저 저장 → id 로 알림 링크를 만든다
  const { data: notice, error: nErr } = await admin
    .from("notices")
    .insert({
      title,
      body,
      link,
      sent_by: user.id,
      recipient_count: ids.length,
    })
    .select("id")
    .single();
  if (nErr || !notice) {
    return { error: "공지 저장에 실패했어요: " + (nErr?.message || "") };
  }

  const noticeLink = `/notices/${notice.id}`;
  const rows = ids.map((uid) => ({
    user_id: uid,
    type: "notice",
    title,
    body,
    link: noticeLink,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin
      .from("notifications")
      .insert(rows.slice(i, i + 500));
    if (error) return { error: "발송 중 오류가 났어요: " + error.message };
  }

  revalidatePath("/admin/notice");
  revalidatePath("/notices");
  revalidatePath("/", "layout");
  return { ok: true, count: ids.length };
}

export async function deleteNotice(id) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin
    .from("notifications")
    .delete()
    .eq("type", "notice")
    .eq("link", `/notices/${id}`);
  await admin.from("notices").delete().eq("id", id);
  revalidatePath("/admin/notice");
  revalidatePath("/notices");
  revalidatePath("/", "layout");
  return { ok: true };
}

// ── 베타 모드 (gmail.com 로그인 허용) 토글 ───────────────────
export async function setBetaMode(open) {
  const { user } = await requireAdmin();
  await setBetaOpen(open, user.id);
  revalidatePath("/admin");
  return { ok: true, betaOpen: !!open };
}

// ── 계정 완전 삭제 (관리자) ──────────────────────────────────
// 제재 목적이면 "영구 정지" 를 쓰고, 이용자의 탈퇴 요청을 대행하는 경우에만 사용.
export async function adminDeleteUser(userId) {
  const { user } = await requireAdmin();
  if (userId === user.id) {
    return { error: "본인 계정은 여기서 삭제할 수 없어요. (회원 탈퇴 사용)" };
  }

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("role, is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { error: "사용자를 찾을 수 없어요." };
  if (target.role === "owner") {
    return { error: "총관리자 계정은 삭제할 수 없어요." };
  }
  if (target.role === "admin" || target.is_admin) {
    return { error: "관리자 계정은 '관리자 해제' 후 삭제하세요." };
  }

  try {
    await hardDeleteUser(userId);
  } catch (e) {
    return { error: "삭제에 실패했어요: " + (e?.message || "알 수 없는 오류") };
  }

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

// ── 권한 등급 변경 (관리자) ──────────────────────────────────
// role: "admin" | "user"  (총관리자 owner 는 DB 에서만 지정/해제)
export async function setUserRole(userId, role) {
  const { user } = await requireAdmin();
  if (!["admin", "user"].includes(role)) return { error: "잘못된 등급이에요." };
  if (userId === user.id) return { error: "본인 등급은 바꿀 수 없어요." };

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return { error: "사용자를 찾을 수 없어요." };
  if (target.role === "owner") {
    return { error: "총관리자 권한은 여기서 변경할 수 없어요." };
  }

  await admin
    .from("profiles")
    .update({ role, is_admin: role === "admin" })
    .eq("id", userId);
  revalidatePath("/admin/users");
  return { ok: true };
}

// 계정 완전 삭제는 제공하지 않는다. 제재는 "영구 정지"(setUserSuspension(id, 0)).
// 재가입 회피가 막히고, 채팅·신고 기록이 남으며, Storage 고아 파일·FK 꼬임이 없다.
