"use client";

import { useEffect, useState } from "react";
import { THEME_MODES, ACCENTS } from "@/lib/theme";
import { applyTheme } from "./ThemeController";

function set(key, value) {
  try {
    if (value == null || value === "system" || value === "blue" || value === "off")
      localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* noop */
  }
  applyTheme();
  window.dispatchEvent(new Event("themechange"));
}

export default function ThemePanel() {
  const [mode, setMode] = useState("system");
  const [accent, setAccent] = useState("blue");
  const [contrast, setContrast] = useState(false);

  useEffect(() => {
    try {
      setMode(localStorage.getItem("theme") || "system");
      setAccent(localStorage.getItem("accent") || "blue");
      setContrast(localStorage.getItem("contrast") === "high");
    } catch {
      /* noop */
    }
  }, []);

  return (
    <section className="card p-5">
      <h2 className="font-bold">화면 테마</h2>

      <p className="mt-3 text-sm font-semibold">모드</p>
      <div className="mt-1.5 flex gap-1 rounded-full bg-sunken p-1">
        {THEME_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMode(m.key);
              set("theme", m.key);
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
              mode === m.key ? "bg-surface text-ink shadow-sm" : "text-ink-soft"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm font-semibold">강조 색상</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {ACCENTS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => {
              setAccent(a.key);
              set("accent", a.key);
            }}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
              accent === a.key
                ? "border-brand bg-brand-tint text-brand-deep"
                : "border-line text-ink-soft"
            }`}
          >
            <span
              className="h-3.5 w-3.5 rounded-full"
              style={{ background: a.color }}
            />
            {a.label}
          </button>
        ))}
      </div>

      <label className="mt-4 flex items-center justify-between text-sm">
        <span className="font-semibold">고대비 모드</span>
        <input
          type="checkbox"
          checked={contrast}
          onChange={(e) => {
            setContrast(e.target.checked);
            set("contrast", e.target.checked ? "high" : "off");
          }}
          className="h-5 w-5 accent-[var(--color-brand)]"
        />
      </label>
    </section>
  );
}
