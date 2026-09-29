// Search-page UI mode (키워드 검색 / AI 검색) in the URL, so a refresh, a
// shared link or the back button restores the mode the user was in.
//
// The page URL uses `searchMode`, not `mode`: `mode` already means the
// *search API* mode (listQuerySchema: keyword | semantic, and the POST
// route's image | ai), and the pages validate it with listQuerySchema -- a
// page URL carrying `mode=ai` fails that validation and silently drops
// every other filter. Older links that used `mode=ai` / `mode=keyword` for
// the UI mode are still honored when reading.
//
// No parameter = the page's own default (/lost, /found: keyword; /search:
// AI). The parameter is only written when the mode differs from it.
import type { SearchUiMode } from "./SearchModeToggle";

export const SEARCH_MODE_PARAM = "searchMode";

type ParamReader = { get(key: string): string | null };

const isUiMode = (value: string | null): value is SearchUiMode => value === "ai" || value === "keyword";

export function resolveSearchUiMode(params: ParamReader, defaultMode: SearchUiMode): SearchUiMode {
  const explicit = params.get(SEARCH_MODE_PARAM);
  if (isUiMode(explicit)) return explicit;
  const legacy = params.get("mode");
  if (isUiMode(legacy)) return legacy;
  return defaultMode;
}

// The query string for switching to `mode`, keeping every other parameter
// (q, type, category, period, ...). A legacy UI-mode `mode=ai|keyword` is
// dropped in favor of `searchMode`; any other `mode` value (e.g. an old
// `mode=semantic` link) is left alone.
export function withSearchMode(search: string, mode: SearchUiMode, defaultMode: SearchUiMode): string {
  const params = new URLSearchParams(search);
  if (isUiMode(params.get("mode"))) params.delete("mode");
  if (mode === defaultMode) params.delete(SEARCH_MODE_PARAM);
  else params.set(SEARCH_MODE_PARAM, mode);
  return params.toString();
}
