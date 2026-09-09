// Phase 11-5: same "tiny external store (useSyncExternalStore contract)"
// pattern src/lib/theme/constants.ts already established for exactly this
// class of problem -- browser-only state (here: matchMedia/navigator/
// localStorage/the beforeinstallprompt event) that must be identical
// between server-rendered HTML and the client's pre-hydration render
// (both start from SERVER_STATE below), and never calls a React setState
// setter from inside an effect body (this project's eslint config flags
// that pattern outright -- react-hooks/set-state-in-effect). See
// ThemeSettings.tsx's own comment on why useSyncExternalStore is the fix.

// Chrome/Edge/Android only fire this -- not in any standard TS DOM lib
// type yet, so it's declared locally rather than pulling in a PWA-typings
// package just for one event shape.
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "pwa-install-dismissed-at";
// Re-shown after this many ms even if the user dismissed it before -- "나중에"
// should mean "not now", not "never again" (this phase's own spec: "반복적으로
// 사용자를 방해하는 modal을 만들지 않는다" -- the balance struck here is a
// long, quiet cooldown, not zero re-prompts forever).
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export type InstallPromptState = {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isIos: boolean;
  // True until standalone/dismissed status is known (SSR + pre-hydration),
  // or once known to actually be hidden (already installed, or recently
  // dismissed) -- InstallAppPrompt renders nothing while this is true,
  // same as `!mounted` below but folded into one flag its render check
  // already needs anyway.
  hidden: boolean;
  mounted: boolean;
};

const SERVER_STATE: InstallPromptState = { deferredPrompt: null, isIos: false, hidden: true, mounted: false };

let snapshot: InstallPromptState = SERVER_STATE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeInstallPromptState(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getInstallPromptSnapshot(): InstallPromptState {
  return snapshot;
}

export function getInstallPromptServerSnapshot(): InstallPromptState {
  return SERVER_STATE;
}

function isRecentlyDismissed(): boolean {
  try {
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    return dismissedAt !== null && Date.now() - Number(dismissedAt) < DISMISS_COOLDOWN_MS;
  } catch {
    // localStorage can throw (private browsing, disabled storage) -- fail
    // open (never dismissed) rather than crash this card.
    return false;
  }
}

function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own non-standard flag -- not in the DOM lib types.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

let browserListenerAttached = false;

// Called once, from InstallAppPrompt's own mount effect -- reads
// browser-only APIs and wires the beforeinstallprompt listener, but never
// touches a React setState setter itself; useSyncExternalStore's own
// subscription is what turns this into a re-render. Safe to call more than
// once (a second call just republishes the same real values and, thanks to
// the guard below, never attaches a second event listener).
export function syncInstallPromptFromBrowser(): void {
  snapshot = {
    deferredPrompt: snapshot.deferredPrompt,
    isIos: /iPad|iPhone|iPod/.test(navigator.userAgent),
    hidden: isStandaloneDisplay() || isRecentlyDismissed(),
    mounted: true,
  };
  notify();

  if (!browserListenerAttached) {
    browserListenerAttached = true;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      snapshot = { ...snapshot, deferredPrompt: event as BeforeInstallPromptEvent };
      notify();
    });
  }
}

// Called from the card's own "닫기"/"나중에" click handlers (a plain event,
// not an effect) -- persists the dismissal and republishes the snapshot.
export function dismissInstallPrompt(): void {
  snapshot = { ...snapshot, hidden: true };
  notify();
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Best-effort only -- worst case, the card just reappears next visit.
  }
}

// Called from the card's own "앱 추가하기" click handler.
export async function triggerInstallPrompt(): Promise<void> {
  const prompt = snapshot.deferredPrompt;
  if (!prompt) return;
  await prompt.prompt();
  await prompt.userChoice;
  // A used prompt can't be shown again -- the browser will fire a fresh
  // beforeinstallprompt on a later visit if the user didn't install.
  snapshot = { ...snapshot, deferredPrompt: null };
  notify();
}
