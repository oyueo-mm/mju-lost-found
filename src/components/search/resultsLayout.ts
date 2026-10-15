export const SEARCH_RESULTS_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4";

// 게시판 리디자인 Phase: /lost and /found (and the AI 검색 results shown
// there). A phone shows one column of list rows (목록형, the default) or a
// 2-column grid of compact cards (격자형); from sm every card is a list row
// with a square thumbnail, two columns up to 1280px and three from there.
// Rows stretch everywhere, so the cards in a row are the same height --
// photo or not -- with no holes between rows, and the reading order is
// the sort order (no masonry / CSS columns).
export const BOARD_RESULTS_GRID_CLASS =
  "grid grid-cols-2 gap-2.5 board-list:grid-cols-1 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3 xl:gap-4";
