"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, isSuspended, SUSPENDED_MSG } from "@/lib/auth";
import { KIND_CONFIG } from "@/lib/constants";
import { isCampus, campusLocationNames } from "@/lib/campus";
import { kstLocalToISO } from "@/lib/format";
import { rateLimited } from "@/lib/ratelimit";

// 응답을 보낸 뒤(사용자를 기다리게 하지 않고) 임베딩을 계산한다.
function scheduleEmbedding(kind, id) {
  after(async () => {
    const { embedPostById } = await import("@/lib/embedding");
    await embedPostById(kind, id);
  });
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 3;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function uploadImage(file, userId) {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 장당 5MB 이하만 올릴 수 있어요.");
  }
  if (file.type && !ALLOWED_TYPES.includes(file.type)) {
    throw new Error("JPG, PNG, WEBP 이미지만 올릴 수 있어요.");
  }
  const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("post-images")
    .upload(path, file, { contentType: file.type || "image/jpeg" });
  if (error) throw new Error("이미지 업로드에 실패했어요.");

  return admin.storage.from("post-images").getPublicUrl(path).data.publicUrl;
}

// formData 의 "image" 여러 개 + 남길 기존 URL("keep") 을 합쳐 최대 3장.
async function collectImages(formData, userId, keptUrls = []) {
  const files = formData.getAll("image").filter((f) => f && typeof f !== "string" && f.size > 0);
  const urls = [...keptUrls];
  for (const file of files.slice(0, MAX_IMAGES - urls.length)) {
    const url = await uploadImage(file, userId);
    if (url) urls.push(url);
  }
  return urls.slice(0, MAX_IMAGES);
}

function readForm(formData, cfg) {
  return {
    title: (formData.get("title") || "").toString().trim(),
    description: (formData.get("description") || "").toString().trim(),
    category: (formData.get("category") || "").toString(),
    campus: (formData.get("campus") || "").toString(),
    location: (formData.get("location") || "").toString().trim(),
    locationDetail: (formData.get("location_detail") || "")
      .toString()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80),
    at: (formData.get("at") || "").toString(),
    status: (formData.get("status") || cfg.defaultStatus).toString(),
  };
}

function validate(v, cfg) {
  if (!v.title || !v.description || !v.category || !v.location || !v.at) {
    return "모든 항목을 입력해 주세요.";
  }
  if (!kstLocalToISO(v.at)) return "시각 형식이 올바르지 않아요.";
  if (!isCampus(v.campus)) return "캠퍼스가 선택되지 않았어요.";
  // 장소는 캠퍼스 공식 건물 목록에서만 (세부 위치는 자유 입력)
  if (!campusLocationNames(v.campus).includes(v.location)) {
    return "장소는 목록에서 골라 주세요.";
  }
  if (v.title.length > 60) return "제목은 60자 이하로 써주세요.";
  if (v.description.length > 2000) return "설명이 너무 길어요.";
  if (!cfg.statuses.includes(v.status)) return "상태 값이 올바르지 않아요.";
  return null;
}

export async function createPost(kind, _prev, formData) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error("알 수 없는 게시판입니다.");
  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "post");
  if (limited) return { error: limited };

  const v = readForm(formData, cfg);
  const err = validate(v, cfg);
  if (err) return { error: err };

  let imageUrls = [];
  try {
    imageUrls = await collectImages(formData, user.id);
  } catch (e) {
    return { error: e.message };
  }

  const { data, error } = await supabase
    .from(cfg.table)
    .insert({
      user_id: user.id,
      title: v.title,
      description: v.description,
      category: v.category,
      campus: v.campus,
      location: v.location,
      location_detail: v.locationDetail || null,
      [cfg.dateField]: kstLocalToISO(v.at),
      image_url: imageUrls[0] || null,
      image_urls: imageUrls.length ? imageUrls : null,
    })
    .select("id")
    .single();

  if (error) return { error: "등록에 실패했어요. 잠시 후 다시 시도해 주세요." };

  if (kind === "lost") {
    // 분실 글은 도착 즉시 매칭 결과를 보여줘야 하므로 임베딩을 동기로 계산
    const { embedPostById } = await import("@/lib/embedding");
    await embedPostById("lost", data.id);
  } else {
    scheduleEmbedding(kind, data.id);
  }
  revalidatePath("/");
  redirect(`/${kind}/${data.id}`);
}

export async function updatePost(kind, id, _prev, formData) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error("알 수 없는 게시판입니다.");
  const { user, profile, supabase } = await requireUser();
  if (isSuspended(profile)) return { error: SUSPENDED_MSG };
  const limited = await rateLimited(user.id, "post_edit");
  if (limited) return { error: limited };

  const { data: existing } = await supabase
    .from(cfg.table)
    .select("user_id, image_url, image_urls")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return { error: "게시글을 찾을 수 없어요." };
  if (existing.user_id !== user.id) return { error: "본인 게시글만 수정할 수 있어요." };

  const v = readForm(formData, cfg);
  const err = validate(v, cfg);
  if (err) return { error: err };

  const existingUrls = Array.isArray(existing.image_urls)
    ? existing.image_urls
    : existing.image_url
      ? [existing.image_url]
      : [];
  const keptUrls = formData.getAll("keep").map(String).filter(Boolean);
  const kept = existingUrls.filter((u) => keptUrls.includes(u));

  let imageUrls = kept;
  try {
    imageUrls = await collectImages(formData, user.id, kept);
  } catch (e) {
    return { error: e.message };
  }

  const { error } = await supabase
    .from(cfg.table)
    .update({
      title: v.title,
      description: v.description,
      category: v.category,
      campus: v.campus,
      location: v.location,
      location_detail: v.locationDetail || null,
      status: v.status,
      [cfg.dateField]: kstLocalToISO(v.at),
      image_url: imageUrls[0] || null,
      image_urls: imageUrls.length ? imageUrls : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return { error: "수정에 실패했어요." };

  scheduleEmbedding(kind, id);
  revalidatePath("/");
  revalidatePath(`/${kind}/${id}`);
  redirect(`/${kind}/${id}`);
}

export async function setPostStatus(kind, id, status) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg || !cfg.statuses.includes(status)) return { error: "잘못된 요청이에요." };
  const { user, supabase } = await requireUser();

  const { error } = await supabase
    .from(cfg.table)
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: "상태 변경에 실패했어요." };
  revalidatePath(`/${kind}/${id}`);
  revalidatePath("/my/posts");
  return { ok: true };
}

export async function deletePost(kind, id) {
  const cfg = KIND_CONFIG[kind];
  if (!cfg) throw new Error("알 수 없는 게시판입니다.");
  const { user, supabase } = await requireUser();

  const { data: existing } = await supabase
    .from(cfg.table)
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing || existing.user_id !== user.id) {
    return { error: "본인 게시글만 삭제할 수 있어요." };
  }

  const { error } = await supabase.from(cfg.table).delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidatePath("/");
  redirect(kind === "lost" ? "/?tab=lost" : "/");
}
