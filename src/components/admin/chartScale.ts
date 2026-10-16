// Y-axis scale for the 운영 통계 charts (StatsCharts). Ticks are clean
// numbers from 0 to a "nice" top at or above the largest value, so a bar
// can be read against the grid instead of guessed from its height. Counts
// get integer ticks: up to 5 every integer is a tick (max 2 -> 0 / 1 / 2),
// above that a 1-2-5 step with at most 5 intervals.

export type Scale = { bottom: number; top: number; ticks: number[]; step: number; decimals: number };

const MAX_INTERVALS = 5;

export function niceScale(max: number, { integer = true }: { integer?: boolean } = {}): Scale {
  // Nothing above 0 (all 0, or nothing measured): a 0-1 frame, so the
  // baseline ticks still sit on an axis.
  if (!(max > 0)) return { bottom: 0, top: 1, ticks: [0, 1], step: 1, decimals: 0 };
  let step: number;
  if (integer && max <= MAX_INTERVALS) step = 1;
  else {
    const mag = 10 ** Math.floor(Math.log10(max / MAX_INTERVALS));
    step = [1, 2, 5, 10].map((m) => m * mag).find((s) => Math.ceil(max / s - 1e-9) <= MAX_INTERVALS) ?? 10 * mag;
    if (integer) step = Math.max(1, Math.round(step));
  }
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step) - 1e-9));
  const count = Math.ceil(max / step - 1e-9);
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toFixed(decimals)));
  return { bottom: 0, top: ticks[ticks.length - 1], ticks, step, decimals };
}

// A level far from 0 (누적 가입 19 -> 23): ticks over the values' own span,
// so growth isn't flattened against a distant 0 -- only when the lowest
// value exceeds the span (1 -> 4 keeps its 0). Only for lines; a bar's
// length always starts at 0.
export function niceRange(min: number, max: number, opts: { integer?: boolean } = {}): Scale {
  if (!(min > 0) || max <= min || min <= max - min) return niceScale(max, opts);
  const { step, decimals } = niceScale(max - min, opts);
  const bottom = Math.floor(min / step + 1e-9) * step;
  if (bottom <= 0) return niceScale(max, opts);
  const count = Math.max(1, Math.ceil((max - bottom) / step - 1e-9));
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((bottom + i * step).toFixed(decimals)));
  return { bottom, top: ticks[ticks.length - 1], ticks, step, decimals };
}

// Axis text: grouped thousands, and from 10,000 the Korean 만 unit
// (12,000 -> 1.2만) so the gutter stays narrow.
export function formatTick(n: number, decimals = 0): string {
  if (Math.abs(n) >= 10_000) return n.toLocaleString("ko-KR", { notation: "compact", maximumFractionDigits: 1 });
  return n.toLocaleString("ko-KR", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

// A data value (tooltip, value label): exact, up to one decimal.
export const formatValue = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

// Every k-th x label so about `max` of them show.
export const labelEvery = (n: number, max = 7) => Math.max(1, Math.ceil(n / max));
