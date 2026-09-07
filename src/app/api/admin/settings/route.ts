import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonError, jsonOk, requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { setGoogleTestMode } from "@/lib/settings/service";

const patchSettingsSchema = z.object({
  googleTestModeEnabled: z.boolean(),
});

// PATCH /api/admin/settings { googleTestModeEnabled: boolean }
// -- currently the only mutable app-wide setting (see schema.prisma's
// AppSettings model). requireAdminForApi() is the actual security
// boundary here (re-verifies a fresh DB-sourced isAdmin, never a
// client-supplied claim) -- the admin page hiding this control from a
// non-admin is UX only, same convention every other admin mutation in
// this app already follows.
export const PATCH = withErrorHandling(async (request: NextRequest) => {
  const auth = await requireAdminForApi();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "잘못된 요청 본문입니다.");
  }

  const parsed = patchSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
  }

  const result = await setGoogleTestMode(auth.user, parsed.data.googleTestModeEnabled);
  if (result.kind === "forbidden") return jsonError(403, "관리자 권한이 필요합니다.");
  return jsonOk(result.data);
});
