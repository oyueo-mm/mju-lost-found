"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function parts(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return { d, h, m, s };
}

const pad = (n) => String(n).padStart(2, "0");

export default function SuspensionCountdown({ until }) {
  const router = useRouter();
  const target = new Date(until).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const left = target - now;
  const refreshed = useRef(false);

  useEffect(() => {
    if (left <= 0 && !refreshed.current) {
      refreshed.current = true;
      router.refresh();
    }
  }, [left, router]);

  if (left <= 0) {
    return (
      <div className="mt-4 rounded-lg bg-brand-tint px-4 py-3 text-sm font-bold text-brand-deep">
        정지가 곧 해제돼요…
      </div>
    );
  }

  const { d, h, m, s } = parts(left);

  return (
    <div className="mt-4 rounded-lg bg-brand-tint px-4 py-3.5 text-center">
      <p className="text-[11px] font-semibold text-brand-deep">정지 해제까지</p>
      <p className="num mt-1 text-2xl font-extrabold tracking-tight text-brand-deep">
        {d > 0 && <span>{d}일 </span>}
        {pad(h)}:{pad(m)}:{pad(s)}
      </p>
    </div>
  );
}
