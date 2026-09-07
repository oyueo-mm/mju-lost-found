// Phase H-3: pure constants, no React/DOM import here on purpose -- both
// the blocking init script in src/app/layout.tsx (plain JS, no bundler)
// and the client ThemeSettings component need the exact same storage keys
// and value sets, so they're defined once here rather than duplicated as
// string literals in two places that could quietly drift apart.

export type ThemeMode = "system" | "light" | "dark";
export type AccentColor = "blue" | "green" | "purple" | "rose" | "amber";

export const THEME_MODE_STORAGE_KEY = "mju-theme-mode";
export const ACCENT_COLOR_STORAGE_KEY = "mju-accent-color";
export const HIGH_CONTRAST_STORAGE_KEY = "mju-high-contrast";

export const DEFAULT_ACCENT: AccentColor = "blue";

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

export const ACCENT_COLORS: { value: AccentColor; label: string; swatch: string }[] = [
  { value: "blue", label: "블루", swatch: "#2f6fed" },
  { value: "green", label: "그린", swatch: "#16a34a" },
  { value: "purple", label: "퍼플", swatch: "#7c3aed" },
  { value: "rose", label: "로즈", swatch: "#e11d48" },
  { value: "amber", label: "앰버", swatch: "#d97706" },
];

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function isAccentColor(value: string | null): value is AccentColor {
  return (ACCENT_COLORS as { value: string }[]).some((a) => a.value === value);
}

// The exact attribute-setting logic, shared between the blocking inline
// script (stringified into <head>, see layout.tsx) and applyTheme() below
// (used by ThemeSettings for a live, no-reload change) -- kept as one
// function body serialized to a string rather than hand-duplicated as
// script text, so the two can never drift out of sync.
export function themeInitScript(): string {
  return `(function(){try{
    var mode=localStorage.getItem(${JSON.stringify(THEME_MODE_STORAGE_KEY)});
    var accent=localStorage.getItem(${JSON.stringify(ACCENT_COLOR_STORAGE_KEY)});
    var contrast=localStorage.getItem(${JSON.stringify(HIGH_CONTRAST_STORAGE_KEY)});
    var root=document.documentElement;
    if(mode==='light'||mode==='dark'){root.setAttribute('data-theme',mode);}
    if(accent){root.setAttribute('data-accent',accent);}
    if(contrast==='true'){root.setAttribute('data-contrast','high');}
  }catch(e){}})();`;
}

// Applies (and persists) one setting to <html> immediately -- used by
// ThemeSettings so a change takes effect without a page reload. Reads
// nothing back from localStorage itself (the caller already knows the
// full current state), just writes.
export function applyTheme(mode: ThemeMode, accent: AccentColor, highContrast: boolean): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  root.setAttribute("data-accent", accent);
  if (highContrast) root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");

  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, accent);
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(highContrast));
  } catch {
    // Private browsing / storage disabled -- the setting still applies for
    // this page view via the attributes above, it just won't survive a
    // reload. Not worth surfacing as an error for a cosmetic preference.
  }
}

// Reads the persisted state back out (ThemeSettings' store below, and the
// blocking script in layout.tsx does its own minimal inline version of
// this same read, see themeInitScript() above). Falls back to defaults
// for a first-time visitor or when storage is unavailable.
export function readStoredTheme(): { mode: ThemeMode; accent: AccentColor; highContrast: boolean } {
  try {
    const mode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    const accent = localStorage.getItem(ACCENT_COLOR_STORAGE_KEY);
    const contrast = localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
    return {
      mode: isThemeMode(mode) ? mode : "system",
      accent: isAccentColor(accent) ? accent : DEFAULT_ACCENT,
      highContrast: contrast === "true",
    };
  } catch {
    return { mode: "system", accent: DEFAULT_ACCENT, highContrast: false };
  }
}

export type ThemeState = { mode: ThemeMode; accent: AccentColor; highContrast: boolean; mounted: boolean };

const SERVER_STATE: ThemeState = { mode: "system", accent: DEFAULT_ACCENT, highContrast: false, mounted: false };

// Phase H-3: a tiny external store (React's useSyncExternalStore contract:
// subscribe/getSnapshot/getServerSnapshot) rather than useState+useEffect
// -- reading localStorage to sync a component's displayed state to it on
// mount is exactly the "subscribe to an external system" case
// useSyncExternalStore exists for, and it does so without ever calling a
// setState setter from inside an effect body (this project's eslint config
// flags that pattern outright, see react-hooks/set-state-in-effect).
// `snapshot` starts as SERVER_STATE (mounted:false) so server-rendered
// markup and the client's pre-hydration render are identical; only
// syncFromStorage()/setThemeState() (both called from a plain event, not
// an effect) ever advance it past that.
let snapshot: ThemeState = SERVER_STATE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeThemeState(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getThemeSnapshot(): ThemeState {
  return snapshot;
}

export function getThemeServerSnapshot(): ThemeState {
  return SERVER_STATE;
}

// Called once, from ThemeSettings' own mount effect -- reads localStorage
// (an external system) and republishes the snapshot, but never touches a
// React setState setter itself; useSyncExternalStore's subscription is
// what turns this into a re-render. A no-op past the first call in
// practice (nothing else in this app writes these keys outside
// setThemeState below), but safe to call more than once regardless.
export function syncThemeStateFromStorage(): void {
  snapshot = { ...readStoredTheme(), mounted: true };
  notify();
}

// The live-change path (a click in ThemeSettings) -- applies the DOM
// attributes + persists to localStorage (applyTheme) and republishes the
// snapshot so every subscribed component re-renders with the new values.
export function setThemeState(mode: ThemeMode, accent: AccentColor, highContrast: boolean): void {
  applyTheme(mode, accent, highContrast);
  snapshot = { mode, accent, highContrast, mounted: true };
  notify();
}
