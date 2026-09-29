// URL <-> UI state for the 기간 검색 필터 (분실/습득 시점 기준). The URL is
// the source of truth (period / from / to / unknownTime -- see
// posts/schema.ts), so a shared link reproduces the same filter in keyword
// and AI search alike. Pure, so it's unit-testable without a DOM.
import { DATE_ONLY, EVENT_PERIODS, type EventPeriod } from "@/lib/posts/eventPeriod";

export const PERIOD_PARAM_KEYS = ["period", "from", "to", "unknownTime"] as const;

export type PeriodState = {
  period: EventPeriod | ""; // "" = 전체 기간
  from: string; // YYYY-MM-DD, custom only
  to: string;
  includeUnknown: boolean;
};

export const EMPTY_PERIOD: PeriodState = { period: "", from: "", to: "", includeUnknown: false };

type ParamReader = { get(key: string): string | null };

// Tolerant read: an unknown/garbled value falls back to "no filter" here
// (the server still rejects a malformed URL with its own message).
export function readPeriodState(params: ParamReader): PeriodState {
  const raw = params.get("period") ?? "";
  const period = (EVENT_PERIODS as readonly string[]).includes(raw) ? (raw as EventPeriod) : "";
  if (!period) return EMPTY_PERIOD;
  const date = (key: string) => {
    const v = params.get(key) ?? "";
    return DATE_ONLY.test(v) ? v : "";
  };
  return {
    period,
    from: period === "custom" ? date("from") : "",
    to: period === "custom" ? date("to") : "",
    includeUnknown: params.get("unknownTime") === "include",
  };
}

// The URL parameters for a state -- nothing at all for 전체 기간; from/to
// only for 직접 선택; unknownTime only while a period applies.
export function periodStateToEntries(state: PeriodState): [string, string][] {
  if (!state.period) return [];
  const entries: [string, string][] = [["period", state.period]];
  if (state.period === "custom") {
    if (state.from) entries.push(["from", state.from]);
    if (state.to) entries.push(["to", state.to]);
  }
  if (state.includeUnknown) entries.push(["unknownTime", "include"]);
  return entries;
}

// Replaces the period parameters in an existing query string, keeping every
// other parameter (q, type, category, ...) as it is.
export function withPeriodParams(search: string, state: PeriodState): string {
  const params = new URLSearchParams(search);
  for (const key of PERIOD_PARAM_KEYS) params.delete(key);
  for (const [key, value] of periodStateToEntries(state)) params.set(key, value);
  return params.toString();
}

export function isPeriodRangeInvalid(state: PeriodState): boolean {
  return state.period === "custom" && !!state.from && !!state.to && state.from > state.to;
}
