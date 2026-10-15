export const SEARCH_RESULTS_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4";

// 게시판 리디자인 Phase: /lost and /found (and the AI 검색 results shown
// there). A phone shows a 2-column grid of compact cards (one column in
// 목록형); from sm every card is a list row with a square thumbnail, two
// columns up to 1280px and three from there. Rows stretch so the cards in
// a row are the same height -- photo or not -- and the reading order is
// the sort order (no masonry / CSS columns).
export const BOARD_RESULTS_GRID_CLASS =
  "grid grid-cols-2 items-start gap-2.5 board-list:grid-cols-1 sm:grid-cols-2 sm:items-stretch sm:gap-3 xl:grid-cols-3 xl:gap-4";
