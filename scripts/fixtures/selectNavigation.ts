// Local preview adapter only. No app server or remote request is involved.
import { useMemo, useSyncExternalStore } from "react";

const event = "select-preview-navigation";
function subscribe(callback: () => void) {
  window.addEventListener(event, callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener(event, callback);
    window.removeEventListener("popstate", callback);
  };
}
function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("Local preview only");
  window.history[replace ? "replaceState" : "pushState"](null, "", url);
  window.dispatchEvent(new Event(event));
}
export function useRouter() {
  return { push: (href: string) => navigate(href), replace: (href: string) => navigate(href, true) };
}
export function useSearchParams() {
  const query = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return useMemo(() => new URLSearchParams(query), [query]);
}
export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
}
