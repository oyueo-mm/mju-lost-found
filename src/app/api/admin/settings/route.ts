import { NextRequest } from "next/server";
import { z } from "zod";

import { jsonError, jsonOk, requireAdminForApi, withErrorHandling } from "@/lib/moderation/http";
import { setGoogleTestMode } from "@/lib/settings/service";
import { runRetention } from "@/lib/retention/service";

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

// GET /api/admin/settings -- the daily clean-up of 회원탈퇴 보유정책
// (lib/retention/service.ts), called by Vercel Cron (vercel.json). It lives
// in this existing route file because the Hobby plan caps a deployment at 12
// serverless functions and a new route would be a 13th. Not an admin
// endpoint: Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything
// else is refused, and without a configured secret nothing runs at all.
export const maxDuration = 60;

export const GET = withErrorHandling(async (request: NextRequest) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(503, "CRON_SECRET is not configured.");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return jsonError(401, "Unauthorized");

  const result = await runRetention();
  console.log("retention run", JSON.stringify(result));
  return jsonOk(result);
});
