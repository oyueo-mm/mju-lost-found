// 게시판 보기 방식 (목록형 / 격자형) -- phone only; tablets and desktops
// have one fixed layout. The choice lives in localStorage (per browser,
// never in the URL, so it survives every search, filter, sort and page
// change) and is mirrored onto <html data-board-view> -- the attribute the
// `board-tile` / `board-row` / `board-list` CSS variants (globals.css) key
// on. Being an attribute set before first paint (boardViewInitScript in
// the root layout), the server-rendered list already has the right
// layout; there is no flash from the default to a saved "list".

export const BOARD_VIEWS = ["grid", "list"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];
export const DEFAULT_BOARD_VIEW: BoardView = "grid";
export const BOARD_VIEW_STORAGE_KEY = "mju-find:board-view";
export const BOARD_VIEW_EVENT = "mju-find:board-view";

export function isBoardView(value: unknown): value is BoardView {
  return value === "grid" || value === "list";
}

export function boardViewInitScript(): string {
  return `(function(){try{var v=localStorage.getItem(${JSON.stringify(BOARD_VIEW_STORAGE_KEY)});if(v==="grid"||v==="list")document.documentElement.setAttribute("data-board-view",v);}catch(e){}})();`;
}

export function readBoardView(): BoardView {
  if (typeof document === "undefined") return DEFAULT_BOARD_VIEW;
  const value = document.documentElement.getAttribute("data-board-view");
  return isBoardView(value) ? value : DEFAULT_BOARD_VIEW;
}

export function applyBoardView(view: BoardView): void {
  document.documentElement.setAttribute("data-board-view", view);
  try {
    localStorage.setItem(BOARD_VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode / blocked storage: the choice still applies to this page.
  }
  window.dispatchEvent(new Event(BOARD_VIEW_EVENT));
}
