import webpush from "web-push";

import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

// 채팅 웹 푸시 (standard Web Push + VAPID; no paid push service). Only new
// messages of a direct 1:1 chat room are pushed -- never thank notes,
// matches, keyword alerts, announcements or status lines.
//
// Delivery is decoupled from sending a message: the message's transaction
// writes one PushOutbox row (only when the receiver has a subscription);
// after the response, deliverPush() claims and sends it, and every later
// chat send also retries a few unsent recent rows (sweepPendingPushes), so a
// lost background run is picked up. A failed push never fails a message.
// One row per message (unique) + a compare-and-set claim = no duplicates
// from this side; the browser/OS may still drop or delay a notification.
//
// The notification never carries message text, the post title or a name:
// "MJU Find / 새로운 채팅 메시지가 도착했어요." and the room's URL.

export const PUSH_TTL_SECONDS = 3600;
export const PUSH_MAX_ATTEMPTS = 3;
// a push is skipped while the receiver is looking at that room: the visible
// tab reports it every 10 s and the mark counts for 25 s. A tab closed
// abruptly (no chance to say so) can therefore still suppress a push for up
// to ~25 s -- a known, bounded limit.
export const PRESENCE_FRESH_MS = 25_000;
// rows older than this are not retried (a late chat ping is noise)
export const PUSH_RETRY_WINDOW_MS = 15 * 60_000;
// a failed push is tried once more shortly after (same background run); later
// retries (swept by newer chat activity) only touch rows at least this old, so
// a push is never hammered and its 3 attempts are spread out
export const PUSH_RETRY_DELAY_MS = 3_000;
export const PUSH_SWEEP_MIN_AGE_MS = 15_000;

export type PushConfig = { publicKey: string; privateKey: string; subject: string };
export function pushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:mjusmartlostfound@gmail.com";
  return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export const PUSH_TEXT = { title: "MJU Find", body: "새로운 채팅 메시지가 도착했어요." } as const;
export function chatPushPayload(chatRoomId: number) {
  return { title: PUSH_TEXT.title, body: PUSH_TEXT.body, url: `/chat/${chatRoomId}`, tag: `chat-${chatRoomId}` };
}

// ---------- subscriptions ----------

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

// The server POSTs to whatever endpoint a subscription names, so only the
// browsers' own push services are accepted (an arbitrary https address would
// turn this into a request relay): Chrome / Android (FCM), Firefox, Safari /
// iOS, Edge (Windows). The list can grow when a browser adds a service.
export const PUSH_SERVICE_HOSTS: RegExp[] = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];
export const MAX_DEVICES_PER_USER = 10;
export function validSubscription(raw: unknown): SubscriptionInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== "string" || r.endpoint.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  if (!PUSH_SERVICE_HOSTS.some((re) => re.test(url.hostname))) return null;
  const b64 = /^[A-Za-z0-9_-]+={0,2}$/;
  const p256dh = r.keys?.p256dh, auth = r.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string" || !b64.test(p256dh) || !b64.test(auth) || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: r.endpoint, keys: { p256dh, auth } };
}

// A device's subscription belongs to whoever is signed in on it now: an
// endpoint saved by another account moves to this one.
export async function saveSubscription(userId: number, sub: SubscriptionInput, deviceLabel: string | null): Promise<number> {
  // a user keeps at most MAX_DEVICES_PER_USER devices: the oldest go first
  const mine = await prisma.pushSubscription.findMany({ where: { userId, NOT: { endpoint: sub.endpoint } }, orderBy: { createdAt: "desc" }, select: { id: true }, skip: MAX_DEVICES_PER_USER - 1 });
  if (mine.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: mine.map((m) => m.id) } } });
  const row = await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, deviceLabel },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, deviceLabel, failureCount: 0 },
    select: { id: true },
  });
  return row.id;
}
export async function deleteSubscription(userId: number, where: { endpoint?: string; id?: number }): Promise<number> {
  if (!where.endpoint && !where.id) return 0;
  const r = await prisma.pushSubscription.deleteMany({ where: { userId, ...(where.endpoint ? { endpoint: where.endpoint } : { id: where.id }) } });
  return r.count;
}
export async function subscriptionStatus(userId: number, endpoint: string | null): Promise<{ thisDevice: boolean; devices: number }> {
  const rows = await prisma.pushSubscription.findMany({ where: { userId }, select: { endpoint: true } });
  return { thisDevice: !!endpoint && rows.some((r) => r.endpoint === endpoint), devices: rows.length };
}

// ---------- presence ----------

export async function markPresence(userId: number, chatRoomId: number, visible: boolean): Promise<void> {
  if (visible) {
    await prisma.chatPresence.upsert({ where: { userId_chatRoomId: { userId, chatRoomId } }, create: { userId, chatRoomId, seenAt: new Date() }, update: { seenAt: new Date() } });
  } else {
    await prisma.chatPresence.deleteMany({ where: { userId, chatRoomId } });
  }
}

// ---------- outbox ----------

type Tx = Pick<Prisma.TransactionClient, "pushSubscription" | "pushOutbox">;
// Inside the message's transaction. Nothing is queued for a receiver with no subscription.
export async function enqueueChatPush(tx: Tx, messageId: number, receiverId: number): Promise<number | null> {
  if ((await tx.pushSubscription.count({ where: { userId: receiverId } })) === 0) return null;
  const row = await tx.pushOutbox.create({ data: { messageId, userId: receiverId }, select: { id: true } });
  return row.id;
}

export type DeliverOutcome = "sent" | "skipped" | "retry" | "not_claimed" | "unconfigured";

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<{ statusCode: number }>;
function defaultSender(cfg: PushConfig): Sender {
  return (sub, payload) =>
    webpush.sendNotification(sub, payload, { TTL: PUSH_TTL_SECONDS, urgency: "high", vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey } });
}

export async function deliverPush(outboxId: number, { send, now = new Date() }: { send?: Sender; now?: Date } = {}): Promise<DeliverOutcome> {
  const cfg = pushConfig();
  if (!cfg && !send) return "unconfigured";
  const row = await prisma.pushOutbox.findUnique({ where: { id: outboxId }, include: { message: { select: { chatRoomId: true, senderUserId: true, hiddenAt: true } } } });
  if (!row || row.sentAt || row.skipped || row.attempts >= PUSH_MAX_ATTEMPTS) return "not_claimed";
  // claim: only one runner moves attempts from n to n+1
  const claimed = await prisma.pushOutbox.updateMany({ where: { id: outboxId, attempts: row.attempts, sentAt: null, skipped: null }, data: { attempts: row.attempts + 1 } });
  if (claimed.count !== 1) return "not_claimed";
  const skip = async (why: string) => {
    await prisma.pushOutbox.update({ where: { id: outboxId }, data: { skipped: why } });
    return "skipped" as const;
  };
  const m = row.message;
  // deleted by its sender or hidden by an admin (both set hiddenAt)
  if (m.hiddenAt) return skip("message_gone");
  const room = await prisma.chatRoom.findUnique({ where: { id: m.chatRoomId }, select: { organizationId: true, initiatorUserId: true, counterpartUserId: true } });
  // direct rooms only, and the receiver must still be its other person
  if (!room || room.organizationId !== null || ![room.initiatorUserId, room.counterpartUserId].includes(row.userId) || row.userId === m.senderUserId) return skip("not_participant");
  const receiver = await prisma.user.findUnique({ where: { id: row.userId }, select: { withdrawnAt: true, deletedAt: true } });
  if (!receiver || receiver.withdrawnAt || receiver.deletedAt) return skip("receiver_gone");
  const presence = await prisma.chatPresence.findUnique({ where: { userId_chatRoomId: { userId: row.userId, chatRoomId: m.chatRoomId } }, select: { seenAt: true } });
  if (presence && now.getTime() - presence.seenAt.getTime() < PRESENCE_FRESH_MS) return skip("viewing");
  const subs = await prisma.pushSubscription.findMany({ where: { userId: row.userId }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
  if (!subs.length) return skip("no_subscription");

  const payload = JSON.stringify(chatPushPayload(m.chatRoomId));
  const sender = send ?? defaultSender(cfg!);
  let delivered = 0;
  let retriable = 0;
  let lastError: string | null = null;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        delivered++;
        await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: now, failureCount: 0 } });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode ?? 0;
        // never log the endpoint or keys
        lastError = `status ${status || "network"}`;
        if (status === 404 || status === 410) {
          // expired / unsubscribed in the browser: forget it
          await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        } else {
          retriable++;
          const updated = await prisma.pushSubscription.update({ where: { id: s.id }, data: { failureCount: { increment: 1 } }, select: { failureCount: true } });
          if (updated.failureCount >= 20) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        }
      }
    }),
  );
  if (delivered > 0) {
    await prisma.pushOutbox.update({ where: { id: outboxId }, data: { sentAt: now, lastError } });
    return "sent";
  }
  if (retriable === 0) return skip("all_expired");
  await prisma.pushOutbox.update({ where: { id: outboxId }, data: { lastError } });
  return "retry";
}

// One delivery run: the push, and one more try a few seconds later if the
// push service answered with a temporary failure.
export async function deliverWithRetry(outboxId: number, opts: { send?: Sender; now?: () => Date; wait?: (ms: number) => Promise<void> } = {}): Promise<DeliverOutcome> {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const first = await deliverPush(outboxId, { send: opts.send, now: opts.now?.() });
  if (first !== "retry") return first;
  await wait(PUSH_RETRY_DELAY_MS);
  return deliverPush(outboxId, { send: opts.send, now: opts.now?.() });
}

// Retry a few recent unsent rows (called after later chat sends).
export async function sweepPendingPushes(limit = 5, { now = new Date(), send }: { now?: Date; send?: Sender } = {}): Promise<number> {
  const rows = await prisma.pushOutbox.findMany({
    where: { sentAt: null, skipped: null, attempts: { lt: PUSH_MAX_ATTEMPTS }, createdAt: { gte: new Date(now.getTime() - PUSH_RETRY_WINDOW_MS), lte: new Date(now.getTime() - PUSH_SWEEP_MIN_AGE_MS) } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let n = 0;
  for (const r of rows) if ((await deliverPush(r.id, { now, send })) === "sent") n++;
  return n;
}

// Housekeeping (daily cron): outbox rows older than 7 days.
export async function prunePushOutbox(now = new Date()): Promise<number> {
  const r = await prisma.pushOutbox.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } });
  return r.count;
}
