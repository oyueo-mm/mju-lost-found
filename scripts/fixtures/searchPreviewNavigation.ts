export { useRouter, useSearchParams, usePathname } from "./selectNavigation";

// Next integrates native History calls with useSearchParams. Mirror just
// that behavior in this standalone preview, without a Next app server.
if (typeof window !== "undefined") {
  for (const method of ["pushState", "replaceState"] as const) {
    const native = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      native(...args);
      window.dispatchEvent(new Event("select-preview-navigation"));
    };
  }
}
