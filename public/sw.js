/* MJU Find service worker -- chat web push only (no caching, no offline).
 * A push carries { title, body, url, tag } and never message text. Clicking
 * the notification focuses an open MJU Find tab on that chat room, or opens
 * it (signing in first if needed brings the user back there). */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const FALLBACK = { title: "MJU Find", body: "새로운 채팅 메시지가 도착했어요.", url: "/chat", tag: "chat" };

function readPayload(event) {
  try {
    const data = event.data ? event.data.json() : {};
    const url = typeof data.url === "string" && data.url.startsWith("/chat") ? data.url : FALLBACK.url;
    return {
      title: typeof data.title === "string" ? data.title : FALLBACK.title,
      body: typeof data.body === "string" ? data.body : FALLBACK.body,
      url,
      tag: typeof data.tag === "string" ? data.tag : FALLBACK.tag,
    };
  } catch {
    return FALLBACK;
  }
}

self.addEventListener("push", (event) => {
  const p = readPayload(event);
  // userVisibleOnly: every push shows a notification. Same room = same tag,
  // so several messages collapse into one (renotify still alerts).
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      renotify: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: p.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/chat", self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== target.origin) continue;
        if ("navigate" in w) await w.navigate(target.href).catch(() => {});
        return w.focus();
      }
      return self.clients.openWindow(target.href);
    })(),
  );
});
