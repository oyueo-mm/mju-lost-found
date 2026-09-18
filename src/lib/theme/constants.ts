// Phase H-3: pure constants, no React/DOM import here on purpose -- both
// the blocking init script in src/app/layout.tsx (plain JS, no bundler)
// and the client ThemeSettings component need the exact same storage keys
// and value sets, so they're defined once here rather than duplicated as
// string literals in two places that could quietly drift apart.

export type ThemeMode = "system" | "light" | "dark";
export type PresetAccentColor = "mjuBlue" | "mjuDarkBlue" | "pink" | "rose" | "lavender" | "green";
export type AccentColor = PresetAccentColor | "custom";

export const THEME_MODE_STORAGE_KEY = "mju-theme-mode";
export const ACCENT_COLOR_STORAGE_KEY = "mju-accent-color";
export const HIGH_CONTRAST_STORAGE_KEY = "mju-high-contrast";
export const CUSTOM_ACCENT_STORAGE_KEY = "mju-custom-accent";

export const DEFAULT_ACCENT: AccentColor = "mjuBlue";

export const THEME_MODES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "시스템" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

export const ACCENT_COLORS: { value: PresetAccentColor; label: string; swatch: string }[] = [
  { value: "mjuBlue", label: "명지 블루", swatch: "#006ec7" },
  { value: "mjuDarkBlue", label: "명지 다크 블루", swatch: "#002968" },
  { value: "pink", label: "핑크색", swatch: "#ff00dd" },
  { value: "rose", label: "장미", swatch: "#ff3d6e" },
  { value: "lavender", label: "연보라", swatch: "#7c3aed" },
  { value: "green", label: "녹색", swatch: "#059669" },
];

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function isAccentColor(value: string | null): value is AccentColor {
  return value === "custom" || (ACCENT_COLORS as { value: string }[]).some((a) => a.value === value);
}

export function normalizeCustomAccent(value: string | null): string | null {
  if (!value) return null;
  const hex = value.trim().match(/^#?([\da-f]{6})$/i);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const rgb = value.trim().match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!rgb || rgb.slice(1).some((part) => Number(part) > 255)) return null;
  return `#${rgb.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

function accentTokens(hex: string): { primary: string; foreground: string; muted: string } {
  const value = hex.slice(1);
  const rgb = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const luminance = rgb.map((channel) => channel / 255).map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const foreground = luminance > 0.179 ? "#111827" : "#ffffff";
  return { primary: hex, foreground, muted: `rgba(${rgb.join(", ")}, 0.14)` };
}

function presetSwatch(accent: AccentColor): string | null {
  return accent === "custom" ? null : ACCENT_COLORS.find((color) => color.value === accent)?.swatch ?? null;
}

function applyAccentTokens(root: HTMLElement, hex: string, highContrast: boolean): void {
  const tokens = accentTokens(hex);
  root.style.setProperty("--primary", tokens.primary);
  root.style.setProperty("--primary-foreground", tokens.foreground);
  root.style.setProperty("--primary-muted", tokens.muted);
  if (highContrast) root.style.removeProperty("--ring");
  else root.style.setProperty("--ring", tokens.primary);
}

export function resolveStoredAccent(accent: string | null, customAccent: string | null): { accent: AccentColor; customAccent: string | null } {
  const normalizedCustomAccent = normalizeCustomAccent(customAccent);
  // Older versions retained the custom value after a preset selection. A
  // valid saved custom value wins during restoration; selecting a preset
  // now clears that value in applyTheme(), so the preference stays explicit.
  if (normalizedCustomAccent) return { accent: "custom", customAccent: normalizedCustomAccent };
  return {
    accent: isAccentColor(accent) && accent !== "custom" ? accent : DEFAULT_ACCENT,
    customAccent: null,
  };
}

// The exact attribute-setting logic, shared between the blocking inline
// script (stringified into <head>, see layout.tsx) and applyTheme() below
// (used by ThemeSettings for a live, no-reload change) -- kept as one
// function body serialized to a string rather than hand-duplicated as
// script text, so the two can never drift out of sync.
export function themeInitScript(): string {
  const swatches = Object.fromEntries(ACCENT_COLORS.map((color) => [color.value, color.swatch]));
  return `(function(){try{
    var mode=localStorage.getItem(${JSON.stringify(THEME_MODE_STORAGE_KEY)});
    var accent=localStorage.getItem(${JSON.stringify(ACCENT_COLOR_STORAGE_KEY)});
    var contrast=localStorage.getItem(${JSON.stringify(HIGH_CONTRAST_STORAGE_KEY)});
    var custom=localStorage.getItem(${JSON.stringify(CUSTOM_ACCENT_STORAGE_KEY)});
    var swatches=${JSON.stringify(swatches)};
    var root=document.documentElement;
    var match=custom&&custom.trim().match(/^#?([\\da-f]{6})$/i);
    if(match){
      custom='#'+match[1].toLowerCase(); accent='custom';
    }
    if(accent!=='custom'&&!swatches[accent]){accent='mjuBlue';}
    if(accent==='custom'&&!match){accent='mjuBlue';}
    var hex=accent==='custom'?custom:swatches[accent];
    var value=hex.slice(1), rgb=[parseInt(value.slice(0,2),16),parseInt(value.slice(2,4),16),parseInt(value.slice(4,6),16)];
    var lum=rgb.map(function(channel){channel/=255;return channel<=.03928?channel/12.92:Math.pow((channel+.055)/1.055,2.4);});
    root.style.setProperty('--primary',hex);
    root.style.setProperty('--primary-foreground',.2126*lum[0]+.7152*lum[1]+.0722*lum[2]>.179?'#111827':'#ffffff');
    root.style.setProperty('--primary-muted','rgba('+rgb.join(', ')+', 0.14)');
    if(contrast!=='true'){root.style.setProperty('--ring',hex);}
    if(mode==='light'||mode==='dark'){root.setAttribute('data-theme',mode);}
    root.setAttribute('data-accent',accent);
    if(contrast==='true'){root.setAttribute('data-contrast','high');}
  }catch(e){}})();`;
}

// Applies (and persists) one setting to <html> immediately -- used by
// ThemeSettings so a change takes effect without a page reload. Reads
// nothing back from localStorage itself (the caller already knows the
// full current state), just writes.
export function applyTheme(mode: ThemeMode, accent: AccentColor, highContrast: boolean, customAccent: string | null = null): void {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  root.setAttribute("data-accent", accent);
  const accentHex = accent === "custom" ? customAccent : presetSwatch(accent);
  if (accentHex) {
    applyAccentTokens(root, accentHex, highContrast);
  } else {
    root.style.removeProperty("--primary");
    root.style.removeProperty("--primary-foreground");
    root.style.removeProperty("--primary-muted");
    root.style.removeProperty("--ring");
  }
  if (highContrast) root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");

  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, accent);
    if (accent === "custom" && customAccent) localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, customAccent);
    else localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
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
export function readStoredTheme(): { mode: ThemeMode; accent: AccentColor; highContrast: boolean; customAccent: string | null } {
  try {
    const mode = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    const accent = localStorage.getItem(ACCENT_COLOR_STORAGE_KEY);
    const contrast = localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY);
    const resolvedAccent = resolveStoredAccent(accent, localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY));
    return {
      mode: isThemeMode(mode) ? mode : "system",
      accent: resolvedAccent.accent,
      highContrast: contrast === "true",
      customAccent: resolvedAccent.customAccent,
    };
  } catch {
    return { mode: "system", accent: DEFAULT_ACCENT, highContrast: false, customAccent: null };
  }
}

export type ThemeState = { mode: ThemeMode; accent: AccentColor; highContrast: boolean; customAccent: string | null; mounted: boolean };

const SERVER_STATE: ThemeState = { mode: "system", accent: DEFAULT_ACCENT, highContrast: false, customAccent: null, mounted: false };

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
export function setThemeState(mode: ThemeMode, accent: AccentColor, highContrast: boolean, customAccent: string | null = null): void {
  applyTheme(mode, accent, highContrast, customAccent);
  snapshot = { mode, accent, highContrast, customAccent, mounted: true };
  notify();
}
