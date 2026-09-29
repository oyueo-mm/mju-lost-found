// Pure page-number layout for Pagination.tsx, kept separate so its edge
// cases are unit-tested without rendering anything.
//
// The first and last pages are always shown, plus `siblings` pages on each
// side of the current one; any other gap collapses into an ellipsis. A gap
// that would hide exactly one page shows that page instead ("1 2 3" rather
// than "1 … 3"), since an ellipsis there saves no space. Examples with
// siblings = 2 and 20 pages:
//   page 1  -> 1 2 3 … 20
//   page 6  -> 1 … 4 5 [6] 7 8 … 20
//   page 20 -> 1 … 18 19 20
export type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

export function getPaginationItems(page: number, totalPages: number, siblings: number): PaginationItem[] {
  if (totalPages < 1) return [];
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const around = Math.max(0, Math.trunc(siblings));

  const pages = new Set<number>([1, totalPages]);
  for (let n = current - around; n <= current + around; n++) {
    if (n >= 1 && n <= totalPages) pages.add(n);
  }
  const sorted = [...pages].sort((a, b) => a - b);

  const items: PaginationItem[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev === 2) items.push(prev + 1);
    else if (prev !== undefined && n - prev > 2) items.push(n < current ? "ellipsis-start" : "ellipsis-end");
    items.push(n);
  });
  return items;
}
