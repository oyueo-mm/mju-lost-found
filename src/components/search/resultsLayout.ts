export const SEARCH_RESULTS_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:gap-4";

// 게시판 리디자인 Phase: /lost and /found (and the AI 검색 results shown
// there). One column of list rows on a phone (PostCard variant="board"),
// two vertical cards from sm, three from lg -- wide enough for a photo to
// read at a glance. Below lg the cards are list rows (equal height,
// photo or not); from lg they are vertical cards that keep their own
// height (items-start) instead of stretching a compact no-photo card to
// its photo neighbour's. The reading order is the sort order (no masonry).
export const BOARD_RESULTS_GRID_CLASS = "grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 lg:items-start lg:gap-4";
