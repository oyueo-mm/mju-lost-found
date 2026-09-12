"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

// 앱 내 이미지 라이트박스. images = string[] (URL), start = 시작 인덱스.
export default function ImageViewer({ images, start = 0, onClose }) {
  const [i, setI] = useState(start);
  const many = images.length > 1;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && many) setI((v) => (v + 1) % images.length);
      else if (e.key === "ArrowLeft" && many)
        setI((v) => (v - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [images.length, many, onClose]);

  // 스와이프
  const [dx, setDx] = useState(0);
  const drag = useRef({ x: 0, active: false });
  function down(e) {
    drag.current = { x: e.clientX, active: true };
  }
  function move(e) {
    if (drag.current.active) setDx(e.clientX - drag.current.x);
  }
  function up() {
    if (!drag.current.active) return;
    drag.current.active = false;
    if (many && Math.abs(dx) > 60) {
      setI((v) =>
        dx < 0
          ? (v + 1) % images.length
          : (v - 1 + images.length) % images.length,
      );
    }
    setDx(0);
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <Icon name="x" size={20} />
      </button>

      {many && (
        <span className="num absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">
          {i + 1} / {images.length}
        </span>
      )}

      <img
        src={images[i]}
        alt=""
        onClick={(e) => e.stopPropagation()}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ transform: `translateX(${dx}px)` }}
        className="max-h-[88vh] max-w-[92vw] touch-pan-y select-none rounded-lg object-contain"
      />

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((v) => (v - 1 + images.length) % images.length);
            }}
            aria-label="이전"
            className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <Icon name="back" size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setI((v) => (v + 1) % images.length);
            }}
            aria-label="다음"
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 rotate-180 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <Icon name="back" size={20} />
          </button>
        </>
      )}
    </div>
  );
}
