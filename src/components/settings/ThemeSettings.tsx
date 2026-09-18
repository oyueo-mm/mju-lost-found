"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  ACCENT_COLORS,
  THEME_MODES,
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemeState,
  subscribeThemeState,
  syncThemeStateFromStorage,
  normalizeCustomAccent,
  type AccentColor,
  type ThemeMode,
} from "@/lib/theme/constants";
import { useI18n } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translate";

const THEME_MODE_KEYS: Record<ThemeMode, TranslationKey> = {
  system: "theme.mode.system",
  light: "theme.mode.light",
  dark: "theme.mode.dark",
};

const ACCENT_COLOR_KEYS: Record<Exclude<AccentColor, "custom">, TranslationKey> = {
  mjuBlue: "theme.accent.mjuBlue",
  mjuDarkBlue: "theme.accent.mjuDarkBlue",
  pink: "theme.accent.pink",
  rose: "theme.accent.rose",
  lavender: "theme.accent.lavender",
  green: "theme.accent.green",
};

// Phase H-3: purely client-side preference (localStorage), same as this
// project's other per-viewer UI conveniences -- no User schema/API change
// for this, since nothing here needs to sync across devices or be visible
// to anyone but the one browser that set it. The blocking script in
// src/app/layout.tsx already applied whatever was stored *before* this
// component ever mounts (avoiding a flash of the wrong theme); the mount
// effect below only re-syncs the shared store (src/lib/theme/constants.ts)
// to that same storage so this component's controls display the right
// selection -- it does not decide the theme on first paint.
//
// useSyncExternalStore instead of useState+useEffect: reading localStorage
// on mount and updating displayed state from it is exactly the "subscribe
// to an external system" case this hook exists for, and unlike a plain
// effect it never calls a setState setter from inside an effect body
// (this project's eslint config rejects that pattern -- see
// react-hooks/set-state-in-effect). syncThemeStateFromStorage() also
// doesn't call setState directly; it republishes the shared store's
// snapshot, and useSyncExternalStore's own subscription is what turns that
// into this component's re-render.
export function ThemeSettings() {
  const { t } = useI18n();
  const customPanelRef = useRef<HTMLDivElement>(null);
  const customTriggerRef = useRef<HTMLButtonElement>(null);
  const [customPanelOpen, setCustomPanelOpen] = useState(false);
  const [customInput, setCustomInput] = useState("#006ec7");
  const { mode, accent, highContrast, mounted } = useSyncExternalStore(
    subscribeThemeState,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  const customAccent = useSyncExternalStore(
    subscribeThemeState,
    () => getThemeSnapshot().customAccent,
    () => null,
  );

  useEffect(() => {
    syncThemeStateFromStorage();
  }, []);

  useEffect(() => {
    if (!customPanelOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!customPanelRef.current?.contains(event.target as Node)) setCustomPanelOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setCustomPanelOpen(false);
      customTriggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [customPanelOpen]);

  function update(nextMode: ThemeMode, nextAccent: AccentColor, nextHighContrast: boolean) {
    setThemeState(nextMode, nextAccent, nextHighContrast, customAccent);
  }

  function applyCustomAccent(value: string) {
    const normalized = normalizeCustomAccent(value);
    if (!normalized) return;
    setCustomInput(normalized);
    setThemeState(mode, "custom", highContrast, normalized);
  }

  return (
    <section id="display-settings" className="flex flex-col gap-5 rounded-card border border-border bg-card p-5">
      <h2 className="font-semibold text-foreground">{t("theme.title")}</h2>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t("theme.mode")}</span>
        <div className="flex gap-2" role="group" aria-label={t("theme.modeAria")}>
          {THEME_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              disabled={!mounted}
              onClick={() => update(m.value, accent, highContrast)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                mode === m.value
                  ? "border-primary bg-primary-muted text-primary"
                  : "border-border text-muted-foreground hover:border-foreground/30"
              }`}
            >
              {t(THEME_MODE_KEYS[m.value])}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">{t("theme.accent")}</span>
        <div ref={customPanelRef} className="relative">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("theme.accentAria")}>
            {ACCENT_COLORS.map((a) => (
              <button
                key={a.value}
                type="button"
                aria-pressed={accent === a.value}
                aria-label={t(ACCENT_COLOR_KEYS[a.value])}
                disabled={!mounted}
                onClick={() => update(mode, a.value, highContrast)}
                className={`flex size-9 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-60 ${
                  accent === a.value ? "border-foreground" : "border-transparent"
                }`}
              >
                <span className="size-6 rounded-full" style={{ backgroundColor: a.swatch }} />
              </button>
            ))}
            <button
              ref={customTriggerRef}
              type="button"
              aria-pressed={accent === "custom"}
              aria-expanded={customPanelOpen}
              aria-controls="custom-accent-panel"
              aria-label={t("theme.accent.custom")}
              disabled={!mounted}
              onClick={() => {
                const initialColor = customAccent ?? "#006ec7";
                setCustomInput(initialColor);
                applyCustomAccent(initialColor);
                setCustomPanelOpen(true);
              }}
              className={`flex size-9 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-60 ${
                accent === "custom" ? "border-foreground" : "border-transparent"
              }`}
            >
              <span className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-sm text-muted-foreground">+</span>
            </button>
          </div>
          {customPanelOpen && (
            <div id="custom-accent-panel" role="dialog" aria-label={t("theme.accent.custom")} className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
            <label className="flex flex-wrap items-center gap-2 text-sm text-foreground">
              <span className="font-medium">{t("theme.accent.customInput")}</span>
              <input
                type="text"
                value={customInput}
                placeholder="#006ec7 or rgb(0, 110, 199)"
                aria-label={t("theme.accent.customInput")}
                onChange={(event) => setCustomInput(event.currentTarget.value)}
                onBlur={(event) => applyCustomAccent(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyCustomAccent(event.currentTarget.value);
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                type="color"
                value={normalizeCustomAccent(customInput) ?? customAccent ?? "#006ec7"}
                aria-label={t("theme.accent.customInput")}
                onChange={(event) => applyCustomAccent(event.target.value)}
                className="size-9 rounded-md border-0 bg-transparent p-0"
              />
            </label>
            <p className="text-xs text-muted-foreground">{t("theme.accent.customHint")}</p>
            </div>
          )}
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{t("theme.highContrast")}</span>
          <span className="text-xs text-muted-foreground">{t("theme.highContrastDescription")}</span>
        </span>
        <input
          type="checkbox"
          checked={highContrast}
          disabled={!mounted}
          onChange={(e) => update(mode, accent, e.target.checked)}
          className="size-5 shrink-0 accent-primary disabled:opacity-60"
        />
      </label>
    </section>
  );
}
