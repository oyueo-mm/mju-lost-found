"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { recordVisitsAction } from "@/app/visitActions";
import { pageKindOf, refSourceOf, sanitizeUtm, SESSION_IDLE_MS, MAX_EVENTS_PER_CALL, type VisitEvent } from "@/lib/metrics/visits";

// 방문 통계 beacon (운영 통계). One event per page the browser actually shows
// (a path change -- filter or page changes on the same screen are not new
// views); prefetches never run this. Events are queued and sent together a
// moment after the last one, off the rendering path, so a quick series of
// navigations is one server call. The queue lives in sessionStorage: a full
// page load (a refresh, a plain link) that cuts the wait short leaves it
// for the next page in the same tab to send, and backgrounding the tab
// sends it at once. An event is taken off the queue just before it is sent,
// so it can be lost (a tab closed within the wait) but never sent twice.
//
// Visit session: kept only in this browser (localStorage: the last view's
// time and KST day). Nothing identifying is sent -- just whether this view
// starts a session, and for that first view the referrer category and the
// UTM tags.
//
// Not counted: browsers driven by automation (navigator.webdriver) and admin
// pages. An opted-out browser ("내 방문 통계에서 제외" on /admin/stats) still
// sends its views, flagged: the server counts them as internal while an admin
// is signed in and drops them otherwise. The opt-out turns on by itself the
// first time an admin is seen in this browser (the server's reply), and stays
// after sign-out; once someone sets it by hand, that choice is kept.
export const STATS_OPT_OUT_KEY = "mju-find:stats-opt-out";
export const STATS_OPT_OUT_SET_KEY = "mju-find:stats-opt-out-set";
export const STATS_OPT_OUT_EVENT = "mju-find:stats-opt-out";

// First time an admin uses this browser: exclude it by default (not if a
// choice was already made here).
export function defaultOptOutForAdmin() {
  try {
    if (window.localStorage.getItem(STATS_OPT_OUT_SET_KEY)) return;
    window.localStorage.setItem(STATS_OPT_OUT_KEY, "1");
    window.localStorage.setItem(STATS_OPT_OUT_SET_KEY, "admin-default");
  } catch {
    return; // no storage: nothing to remember
  }
  window.dispatchEvent(new Event(STATS_OPT_OUT_EVENT));
}

function optedOut(): boolean {
  try {
    return window.localStorage.getItem(STATS_OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}
const SESSION_KEY = "mju-find:visit";
const QUEUE_KEY = "mju-find:visit-queue";
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SEND_DELAY_MS = 1500;
const kstDay = (ms: number) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

let timer: ReturnType<typeof setTimeout> | null = null;
let lastPath: { path: string; at: number } | null = null;
let memorySession: number | null = null; // when storage is unavailable
let memoryQueue: VisitEvent[] = []; // when storage is unavailable
let unloading = false;

function readQueue(): VisitEvent[] {
  try {
    const raw = window.sessionStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as VisitEvent[]) : [];
  } catch {
    return memoryQueue;
  }
}

function writeQueue(events: VisitEvent[]) {
  // A long-unsent queue (a tab backgrounded offline) is capped, oldest dropped.
  const capped = events.slice(-MAX_EVENTS_PER_CALL * 3);
  try {
    if (capped.length) window.sessionStorage.setItem(QUEUE_KEY, JSON.stringify(capped));
    else window.sessionStorage.removeItem(QUEUE_KEY);
  } catch {
    memoryQueue = capped;
  }
}

function send() {
  if (timer) clearTimeout(timer);
  timer = null;
  const queue = readQueue();
  if (queue.length === 0) return;
  const batch = queue.slice(0, MAX_EVENTS_PER_CALL);
  writeQueue(queue.slice(MAX_EVENTS_PER_CALL));
  // touch: whether this browser has a touch screen -- the one detail the
  // server can't see, needed to tell an iPad (Mac User-Agent) from a Mac.
  recordVisitsAction(batch, { optedOut: optedOut(), touch: navigator.maxTouchPoints > 1 })
    .then((reply) => {
      if (reply?.admin) defaultOptOutForAdmin();
    })
    .catch(() => {});
  if (queue.length > MAX_EVENTS_PER_CALL) timer = setTimeout(send, SEND_DELAY_MS);
}

function schedule(delay = SEND_DELAY_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(send, delay);
}

function startsSession(now: number): boolean {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    const prev = raw ? (JSON.parse(raw) as { last?: number; day?: string }) : null;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify({ last: now, day: kstDay(now) }));
    return !prev?.last || now - prev.last > SESSION_IDLE_MS || prev.day !== kstDay(now);
  } catch {
    const fresh = memorySession === null || now - memorySession > SESSION_IDLE_MS;
    memorySession = now;
    return fresh;
  }
}

export function VisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    if (navigator.webdriver) return;
    const kind = pageKindOf(pathname);
    if (!kind) return;
    const now = Date.now();
    // The same screen reported twice in a row within 2s (a remount) is one view.
    if (lastPath && lastPath.path === pathname && now - lastPath.at < 2000) return;
    lastPath = { path: pathname, at: now };

    const event: VisitEvent = { kind, sessionStart: startsSession(now) };
    if (event.sessionStart) {
      const params = new URLSearchParams(window.location.search);
      event.ref = refSourceOf(document.referrer, window.location.host);
      event.utmSource = sanitizeUtm(params.get("utm_source"));
      event.utmCampaign = sanitizeUtm(params.get("utm_campaign"));
    }
    writeQueue([...readQueue(), event]);
    schedule();
  }, [pathname]);

  useEffect(() => {
    // Left by the previous page in this tab (it unloaded before sending).
    if (readQueue().length) schedule(300);
    // Backgrounding the tab: send now (the page stays alive). Unloading
    // (pagehide comes first) keeps the queue for the next page instead --
    // a request started while unloading is usually cut off.
    const onPageHide = () => {
      unloading = true;
    };
    const onPageShow = () => {
      unloading = false;
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && !unloading) send();
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return null;
}
