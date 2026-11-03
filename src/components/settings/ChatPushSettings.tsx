"use client";

import { useEffect, useState } from "react";

import { deletePushSubscriptionAction, pushStatusAction, savePushSubscriptionAction } from "@/app/(main)/me/push/actions";
import { useI18n } from "@/lib/i18n/client";
import { pushEnvironment, type PushEnvironment } from "@/lib/push/environment";

// 채팅 푸시 알림 (off by default, per device). Turning it on is the only
// thing that asks the browser for permission; a denied permission is never
// asked again -- the user is told where to allow it. Where web push cannot
// work (in-app browsers, iPhone Safari tabs outside the home-screen app,
// unsupported browsers) nothing is requested and the way forward is shown.

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : "기타";
  const br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${os} · ${br}`;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export function ChatPushSettings({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const { t } = useI18n();
  const [env, setEnv] = useState<PushEnvironment | null>(null);
  const [on, setOn] = useState(false);
  const [otherDevices, setOtherDevices] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const e = pushEnvironment({
        userAgent: navigator.userAgent,
        hasServiceWorker: "serviceWorker" in navigator,
        hasPushManager: "PushManager" in window,
        hasNotification: "Notification" in window,
        standalone: window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
        permission: "Notification" in window ? Notification.permission : "default",
      });
      let thisDevice = false, devices = 0;
      if (e.kind === "ready" || e.kind === "denied") {
        const sub = await currentSubscription().catch(() => null);
        const status = await pushStatusAction(sub?.endpoint ?? null).catch(() => ({ thisDevice: false, devices: 0 }));
        thisDevice = status.thisDevice && !!sub && Notification.permission === "granted";
        devices = status.devices;
        // the browser still has a subscription the server forgot (e.g. after
        // signing out): re-save it only if the user had permission granted
        if (sub && !status.thisDevice && Notification.permission === "granted") thisDevice = false;
      }
      if (cancelled) return;
      setEnv(e);
      setOn(thisDevice);
      setOtherDevices(Math.max(0, devices - (thisDevice ? 1 : 0)));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEnv((e) => (e ? { ...e, kind: permission === "denied" ? "denied" : e.kind } : e));
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
      const r = await savePushSubscriptionAction(sub.toJSON(), deviceLabel());
      if (!r.ok) throw new Error("save");
      setOn(true);
      setOtherDevices(Math.max(0, (r.devices ?? 1) - 1));
    } catch {
      setError(t("push.failed"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      const sub = await currentSubscription().catch(() => null);
      await deletePushSubscriptionAction(sub?.endpoint ?? null);
      await sub?.unsubscribe().catch(() => false);
      setOn(false);
    } catch {
      setError(t("push.failed"));
    } finally {
      setBusy(false);
    }
  };

  // not configured on this deployment (no VAPID keys): the feature does not exist for users
  if (!vapidPublicKey) return null;

  const guide = env?.kind === "in_app" ? t("push.inApp") : env?.kind === "ios_tab" ? t("push.iosHome") : env?.kind === "unsupported" ? t("push.unsupported") : env?.kind === "denied" ? t("push.denied") : null;
  const canToggle = env?.kind === "ready" && !!vapidPublicKey;

  return (
    <section aria-labelledby="chat-push-title" className="flex flex-col gap-2 rounded-card border border-border bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="chat-push-title" className="font-semibold text-foreground">
            {t("push.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("push.desc")}</p>
        </div>
        {canToggle && (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="chat-push-title"
            disabled={busy}
            onClick={on ? disable : enable}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
          >
            <span className="sr-only">{on ? t("push.disable") : t("push.enable")}</span>
            <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        )}
      </div>
      {env && canToggle && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {busy ? t("push.working") : on ? t("push.statusOn") : t("push.statusOff")}
          {otherDevices > 0 && ` · ${t("push.otherDevices", { count: otherDevices })}`}
        </p>
      )}
      {guide && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground">{guide}</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {(canToggle || env?.kind === "denied") && <p className="text-[11px] leading-relaxed text-muted-foreground">{t("push.limits")}</p>}
    </section>
  );
}
