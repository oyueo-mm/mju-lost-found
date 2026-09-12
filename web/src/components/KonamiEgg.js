"use client";

import { useEffect, useState } from "react";

const SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowLeft",
  "ArrowLeft",
  "ArrowLeft",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
  "ArrowRight",
];

const COLORS = ["#0b4da2", "#aecae9", "#c9781f", "#f7efe3", "#141519", "#ffffff"];

function burst() {
  const layer = document.createElement("div");
  layer.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
  document.body.appendChild(layer);

  const N = 90;
  for (let i = 0; i < N; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 8;
    const left = Math.random() * 100;
    const delay = Math.random() * 0.4;
    const dur = 1.8 + Math.random() * 1.6;
    const rot = Math.random() * 720 - 360;
    p.style.cssText = `
      position:absolute;top:-16px;left:${left}vw;
      width:${size}px;height:${size * (0.4 + Math.random())}px;
      background:${COLORS[i % COLORS.length]};
      border-radius:${Math.random() < 0.5 ? "50%" : "1px"};
      opacity:0;
      animation:konami-fall ${dur}s cubic-bezier(0.3,0.6,0.4,1) ${delay}s forwards;
      --rot:${rot}deg;
    `;
    layer.appendChild(p);
  }

  setTimeout(() => layer.remove(), 4200);
}

export default function KonamiEgg() {
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let idx = 0;

    function onKey(e) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === SEQUENCE[idx]) {
        idx++;
        if (idx === SEQUENCE.length) {
          idx = 0;
          fire();
        }
      } else {
        idx = key === SEQUENCE[0] ? 1 : 0;
      }
    }

    function fire() {
      try {
        localStorage.setItem("mjido-boost", "1");
      } catch {
        /* noop */
      }
      burst();
      setToast(true);
      window.setTimeout(() => setToast(false), 3600);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <style>{`
        @keyframes konami-fall {
          0%   { opacity:1; transform:translateY(0) rotate(0); }
          100% { opacity:1; transform:translateY(105vh) rotate(var(--rot)); }
        }
        @keyframes konami-toast {
          0%   { opacity:0; transform:translate(-50%, 12px) scale(0.96); }
          10%  { opacity:1; transform:translate(-50%, 0) scale(1); }
          90%  { opacity:1; transform:translate(-50%, 0) scale(1); }
          100% { opacity:0; transform:translate(-50%, 12px) scale(0.98); }
        }
      `}</style>
      {toast && (
        <div
          role="status"
          style={{ animation: "konami-toast 3.6s ease forwards" }}
          className="fixed bottom-24 left-1/2 z-[9999] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-solid px-4 py-3 text-white shadow-pop sm:bottom-10"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-base">
            🎓
          </span>
          <span className="text-sm">
            <b>명지도가 +100%p 올랐어요</b>
            <span className="block text-xs text-white/70">
              거래 완료 보너스가 지급됐어요
            </span>
          </span>
        </div>
      )}
    </>
  );
}
