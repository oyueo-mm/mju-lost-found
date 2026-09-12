// 명지도 (신뢰도) 배지 — 50%에서 시작, 최대 100%
export default function MannerScore({
  score = 50,
  bar = false,
  className = "",
}) {
  const raw = Math.max(0, Math.min(100, Number(score) || 0));
  const n = Math.round(raw * 10) / 10; // 소수 첫째 자리
  const label = Number.isInteger(n) ? n : n.toFixed(1);
  const tier = n >= 65 ? "high" : n >= 45 ? "mid" : "low";
  const text = {
    high: "text-emerald-600",
    mid: "text-brand",
    low: "text-rose-500",
  }[tier];
  const fill = {
    high: "bg-emerald-500",
    mid: "bg-brand",
    low: "bg-rose-400",
  }[tier];

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium text-ink-faint">명지도</span>
      <span className={`text-xs font-bold ${text}`}>{label}%</span>
      {bar && (
        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
          <span
            className={`block h-full rounded-full ${fill}`}
            style={{ width: `${n}%` }}
          />
        </span>
      )}
    </span>
  );
}
