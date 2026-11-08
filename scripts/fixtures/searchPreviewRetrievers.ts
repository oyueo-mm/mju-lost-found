// Local-only, read-only snapshot adapters. Production uses Prisma/pgvector.
import { readFileSync } from "node:fs";
import type { ListParams, PostDTO } from "../../src/lib/posts/service";
import type { PostListType } from "../../src/lib/posts/schema";
import { compareForSort } from "../../src/lib/posts/postSort";
import { queryEmbedding } from "../../src/lib/ai/queryEmbedding";
import { getImageEmbeddingProvider } from "../../src/lib/ai/imageEmbedding";
import { cosineSimilarity, normalizeScore } from "../../src/lib/ai/matching";
import { aiSimilarity, candidatePool, rankByAiSimilarity } from "../../src/lib/ai/rankFusion";
import { kstDateOnly } from "../../src/lib/posts/eventPeriod";

type SnapshotPost = PostDTO & { embedding: number[] | null; imageEmbedding: number[] | null };
const data = JSON.parse(readFileSync(".vercel/unified-search-preview/posts.json", "utf8")) as SnapshotPost[];
export const posts = data.map((post) => ({ ...post, createdAt: new Date(post.createdAt), updatedAt: new Date(post.updatedAt) }));
export { compareForSort };
export const totalPagesFor = (total: number, limit: number) => Math.max(1, Math.ceil(total / limit));
export function dto(post: SnapshotPost): PostDTO {
  const { embedding, imageEmbedding, ...publicPost } = post;
  void embedding; void imageEmbedding;
  return publicPost;
}
function sortBy(sort: ListParams["sort"], a: PostDTO, b: PostDTO) {
  return compareForSort(sort)({ ...a, commentCount: a.commentCount ?? 0 }, { ...b, commentCount: b.commentCount ?? 0 }) || a.type.localeCompare(b.type);
}
function filtered(type: PostListType, filters: Omit<ListParams, "page" | "limit">) {
  return posts.filter((post) => {
    if (type !== "all" && post.type !== type) return false;
    for (const key of ["category", "categoryCode", "subcategory", "campus", "status"] as const) if (filters[key] && post[key] !== filters[key]) return false;
    if (filters.eventFrom || filters.eventTo) {
      const date = post.type === "lost" ? post.lostDate : post.foundDate;
      if (!date) return Boolean(filters.includeUnknownEventTime);
      if (filters.eventFrom && date < kstDateOnly(filters.eventFrom)) return false;
      if (filters.eventTo && date > kstDateOnly(filters.eventTo)) return false;
    }
    return true;
  });
}
export async function searchPosts({ type, page, limit, ...filters }: ListParams & { type: PostListType }) {
  const query = filters.q?.trim().toLocaleLowerCase();
  const candidates = filtered(type, filters).filter((post) => !query || post.title.toLocaleLowerCase().includes(query) || post.description.toLocaleLowerCase().includes(query)).sort((a, b) => sortBy(filters.sort, a, b));
  return { items: candidates.slice((page - 1) * limit, page * limit).map(dto), page, limit, total: candidates.length, totalPages: totalPagesFor(candidates.length, limit) };
}
function vectorCandidates(type: PostListType, vector: number[], signal: "embedding" | "imageEmbedding", filters: Omit<ListParams, "page" | "limit">) {
  const candidates = filtered(type, filters).filter((post) => post[signal]).map((post) => ({ post, cosine: cosineSimilarity(vector, post[signal]!), score: normalizeScore(cosineSimilarity(vector, post[signal]!)) }));
  return candidates.sort((a, b) => b.cosine - a.cosine || a.post.id - b.post.id).slice(0, 10).filter((entry) => entry.score >= 0.65);
}
export async function searchTextCandidatesForFusion(type: PostListType, query: string, filters: Omit<ListParams, "page" | "limit">): Promise<PostDTO[]> {
  const vector = await queryEmbedding(query);
  const boards = type === "all" ? ["lost", "found"] as const : [type];
  const tokens = query.split(/\s+/).filter((word) => word.length >= 2);
  return boards.flatMap((board) => vectorCandidates(board, vector, "embedding", filters)).map((entry) => ({
    ...entry, rank: Math.min(1, entry.score + (tokens.some((word) => entry.post.title.includes(word)) ? 0.03 : 0)),
  })).sort((a, b) => b.rank - a.rank || a.post.id - b.post.id || a.post.type.localeCompare(b.post.type)).slice(0, 10).map(({ post, cosine }) => ({ ...dto(post), score: aiSimilarity(cosine, null)!.score }));
}
export async function searchPreviewImage(type: Exclude<PostListType, "all">, query: string | undefined, image: Blob, { page, limit, ...filters }: ListParams) {
  const [text, photo] = await Promise.all([query ? queryEmbedding(query) : null, getImageEmbeddingProvider().embed(image)]);
  const imageRanking = vectorCandidates(type, photo, "imageEmbedding", filters);
  const textRanking = text ? vectorCandidates(type, text, "embedding", filters) : [];
  const ids = candidatePool(imageRanking.map((entry) => entry.post), textRanking.map((entry) => entry.post));
  const eligible = filtered(type, filters).filter((post) => ids.includes(post.id));
  const rankings = text ? rankByAiSimilarity(eligible.map((post) => ({ id: post.id, text: post.embedding ? cosineSimilarity(text, post.embedding) : null, image: post.imageEmbedding ? cosineSimilarity(photo, post.imageEmbedding) : null }))) : imageRanking.map((entry) => ({ id: entry.post.id, score: entry.score }));
  let items = rankings.map((rank) => ({ ...dto(eligible.find((post) => post.id === rank.id)!), score: rank.score }));
  if (filters.sort && filters.sort !== "relevance") items = items.sort((a, b) => sortBy(filters.sort, a, b));
  return { items: items.slice((page - 1) * limit, page * limit), page, limit, total: items.length, totalPages: totalPagesFor(items.length, limit) };
}
