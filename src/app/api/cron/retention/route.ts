import { runRetention } from "@/lib/retention/service";
import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";

// 회원탈퇴 보유정책: the daily clean-up (lib/retention/service.ts), called by
// Vercel Cron (vercel.json). Vercel sends `Authorization: Bearer
// <CRON_SECRET>`; anything else is refused, and without a configured
// secret nothing runs at all.
export const maxDuration = 60;

export const GET = withErrorHandling(async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return jsonError(503, "CRON_SECRET is not configured.");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return jsonError(401, "Unauthorized");

  const result = await runRetention();
  console.log("retention run", JSON.stringify(result));
  return jsonOk(result);
});
