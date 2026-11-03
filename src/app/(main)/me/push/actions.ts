"use server";

import { cookies } from "next/headers";

import { requireUser } from "@/lib/auth/session";
import { getChatRoomParticipantIds } from "@/lib/chat/service";
import { deleteSubscription, markPresence, saveSubscription, subscriptionStatus, validSubscription } from "@/lib/push/service";

// 채팅 웹 푸시. Only the signed-in account's own subscriptions are touched
// (requireUser); nothing here ever returns an endpoint or a key. The
// subscription id of this device is kept in an httpOnly cookie so signing
// out can forget exactly this device (forgetThisDevicePush).

const PUSH_DEVICE_COOKIE = "mju-push-device";

export async function savePushSubscriptionAction(raw: unknown, deviceLabel: string | null): Promise<{ ok: boolean; devices?: number }> {
  const user = await requireUser();
  const sub = validSubscription(raw);
  if (!sub) return { ok: false };
  const id = await saveSubscription(user.id, sub, typeof deviceLabel === "string" ? deviceLabel.slice(0, 80) : null);
  (await cookies()).set(PUSH_DEVICE_COOKIE, String(id), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 24 * 3600 });
  const status = await subscriptionStatus(user.id, sub.endpoint);
  return { ok: true, devices: status.devices };
}

export async function deletePushSubscriptionAction(endpoint: string | null): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const jar = await cookies();
  const cookieId = Number(jar.get(PUSH_DEVICE_COOKIE)?.value);
  if (typeof endpoint === "string" && endpoint.length <= 2000) await deleteSubscription(user.id, { endpoint });
  if (Number.isInteger(cookieId) && cookieId > 0) await deleteSubscription(user.id, { id: cookieId });
  jar.delete(PUSH_DEVICE_COOKIE);
  return { ok: true };
}

export async function pushStatusAction(endpoint: string | null): Promise<{ thisDevice: boolean; devices: number }> {
  const user = await requireUser();
  return subscriptionStatus(user.id, typeof endpoint === "string" && endpoint.length <= 2000 ? endpoint : null);
}

// The room is on screen (visible tab) -- or no longer.
export async function chatPresenceAction(chatRoomId: number, visible: boolean): Promise<void> {
  const user = await requireUser();
  if (!Number.isInteger(chatRoomId)) return;
  const ids = await getChatRoomParticipantIds(chatRoomId);
  if (!ids?.has(user.id)) return;
  await markPresence(user.id, chatRoomId, visible === true);
}
