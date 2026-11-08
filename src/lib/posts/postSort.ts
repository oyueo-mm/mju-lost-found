import { DEFAULT_SORT, type SortOption } from "./schema";

type SortKeys = { createdAt: Date; id: number; viewCount: number; commentCount: number };
export function compareForSort(sort: SortOption = DEFAULT_SORT) {
  const newest = (a: SortKeys, b: SortKeys) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id;
  if (sort === "views") return (a: SortKeys, b: SortKeys) => b.viewCount - a.viewCount || newest(a, b);
  if (sort === "comments") return (a: SortKeys, b: SortKeys) => b.commentCount - a.commentCount || newest(a, b);
  if (sort === "oldest") return (a: SortKeys, b: SortKeys) => -newest(a, b);
  return newest;
}
