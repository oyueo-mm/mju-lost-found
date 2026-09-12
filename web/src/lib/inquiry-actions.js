"use server";

import { revalidatePath } from "next/cache";
import { requireUser, requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { INQUIRY_CATEGORIES } from "@/lib/inquiry";

async function notifyAdmins(admin, { title, body, excludeId }) {
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .or("role.eq.admin,is_admin.eq.true");
  for (const a of admins || []) {
    if (a.id === excludeId) continue;
    await createNotification(a.id, "inquiry", title, body, "/admin/inquiries");
  }
}

export async function submitInquiry(_prev, formData) {
  const { user } = await requireUser();
  const category = (formData.get("category") || "").toString();
  const message = (formData.get("message") || "").toString().trim();

  if (!INQUIRY_CATEGORIES.includes(category)) {
    return { error: "분류를 선택해 주세요." };
  }
  if (message.length < 5) {
    return { error: "문의 내용을 조금 더 자세히 적어주세요. (5자 이상)" };
  }
  if (message.length > 2000) return { error: "2000자 이내로 적어주세요." };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: inq, error } = await admin
    .from("inquiries")
    .insert({
      user_id: user.id,
      category,
      message,
      status: "open",
      last_message_at: now,
    })
    .select("id")
    .single();
  if (error || !inq) {
    return { error: "접수에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  await admin.from("inquiry_messages").insert({
    inquiry_id: inq.id,
    sender_id: user.id,
    staff: false,
    body: message,
    created_at: now,
  });

  await notifyAdmins(admin, {
    title: "새 1:1 문의",
    body: `[${category}] ${message.slice(0, 100)}`,
  });

  revalidatePath("/my/inquiries");
  revalidatePath("/admin/inquiries");
  return { ok: true, id: inq.id };
}

// 이용자 후속 답장 → 문의 재오픈 + 관리자 알림
export async function replyInquiry(id, bodyRaw) {
  const { user } = await requireUser();
  const body = (bodyRaw || "").toString().trim();
  if (body.length < 2) return { error: "내용을 입력해 주세요." };
  if (body.length > 2000) return { error: "2000자 이내로 적어주세요." };

  const admin = createAdminClient();
  const { data: inq } = await admin
    .from("inquiries")
    .select("id, user_id, category, status")
    .eq("id", id)
    .maybeSingle();
  if (!inq || inq.user_id !== user.id) return { error: "문의를 찾을 수 없어요." };
  if (inq.status === "closed") return { error: "종료된 문의예요." };

  const now = new Date().toISOString();
  await admin.from("inquiry_messages").insert({
    inquiry_id: id,
    sender_id: user.id,
    staff: false,
    body,
    created_at: now,
  });
  await admin
    .from("inquiries")
    .update({ status: "open", last_message_at: now })
    .eq("id", id);

  await notifyAdmins(admin, {
    title: "문의에 답장이 왔어요",
    body: `[${inq.category}] ${body.slice(0, 100)}`,
  });

  revalidatePath("/my/inquiries");
  revalidatePath(`/my/inquiries/${id}`);
  revalidatePath("/admin/inquiries");
  return { ok: true };
}

// 관리자 답변 → 이용자 알림
export async function answerInquiry(id, answerRaw) {
  const { user } = await requireAdmin();
  const answer = (answerRaw || "").toString().trim();
  if (answer.length < 2) return { error: "답변을 입력해 주세요." };
  if (answer.length > 2000) return { error: "2000자 이내로 적어주세요." };

  const admin = createAdminClient();
  const { data: inq } = await admin
    .from("inquiries")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!inq) return { error: "문의를 찾을 수 없어요." };

  const now = new Date().toISOString();
  await admin.from("inquiry_messages").insert({
    inquiry_id: id,
    sender_id: user.id,
    staff: true,
    body: answer,
    created_at: now,
  });
  await admin
    .from("inquiries")
    .update({
      status: "answered",
      answer,
      answered_by: user.id,
      answered_at: now,
      last_message_at: now,
    })
    .eq("id", id);

  await createNotification(
    inq.user_id,
    "inquiry",
    "문의 답변이 등록됐어요",
    answer.slice(0, 120),
    `/my/inquiries/${id}`,
  );

  revalidatePath("/admin/inquiries");
  revalidatePath("/my/inquiries");
  revalidatePath(`/my/inquiries/${id}`);
  return { ok: true };
}

export async function closeInquiry(id) {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.from("inquiries").update({ status: "closed" }).eq("id", id);
  revalidatePath("/admin/inquiries");
  revalidatePath(`/my/inquiries/${id}`);
  return { ok: true };
}
