"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  ACCENT_COLORS,
  THEME_MODES,
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemeState,
  subscribeThemeState,
  syncThemeStateFromStorage,
  type AccentColor,
  type ThemeMode,
} from "@/lib/theme/constants";

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
  const { mode, accent, highContrast, mounted } = useSyncExternalStore(
    subscribeThemeState,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  useEffect(() => {
    syncThemeStateFromStorage();
  }, []);

  function update(nextMode: ThemeMode, nextAccent: AccentColor, nextHighContrast: boolean) {
    setThemeState(nextMode, nextAccent, nextHighContrast);
  }

  return (
    <section className="flex flex-col gap-5 rounded-card border border-border bg-card p-5">
      <h2 className="font-semibold text-foreground">화면 설정</h2>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">테마 모드</span>
        <div className="flex gap-2" role="group" aria-label="테마 모드 선택">
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
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">강조 색상</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="강조 색상 선택">
          {ACCENT_COLORS.map((a) => (
            <button
              key={a.value}
              type="button"
              aria-pressed={accent === a.value}
              aria-label={a.label}
              disabled={!mounted}
              onClick={() => update(mode, a.value, highContrast)}
              className={`flex size-9 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-60 ${
                accent === a.value ? "border-foreground" : "border-transparent"
              }`}
            >
              <span className="size-6 rounded-full" style={{ backgroundColor: a.swatch }} />
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">고대비 모드</span>
          <span className="text-xs text-muted-foreground">텍스트·배경·버튼의 대비를 높여 더 뚜렷하게 표시합니다.</span>
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
