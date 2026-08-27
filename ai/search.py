"""Natural-language semantic search over LostPost/FoundPost candidates.

Unlike ai.matching.rank_similar_posts (which ranks candidates against
*another post*), the target here is a raw free-text query typed by a user
("검은색 에어팟을 도서관에서 잃어버렸어요"). Everything else -- embedding
the candidates, scoring, ranking -- is deliberately reused from
ai.embedding / ai.matching rather than reimplemented.

    query
      |  embedding.get_embedding()   <- 1x
      v
    query_vec
      |
      |   candidate posts
      |     |  embedding.build_embedding_text() + embedding.get_embeddings()
      |     v
      |   candidate_vecs
      v
    matching.cosine_similarity() for each candidate
      |
      v
    sort descending, take top_k

This brute-force shape (embed everything, score, sort) is what would later
plug into an embedding cache or a vector index: swap out
`embedding.get_embeddings(post_texts)` for a lookup of precomputed vectors
without changing the ranking logic below it.
"""

from __future__ import annotations

from typing import Any

from ai import embedding
from ai.matching import MatchCandidate, cosine_similarity

DEFAULT_TOP_K = 10


def search_similar_posts(
    query: str, posts: list[Any], top_k: int = DEFAULT_TOP_K
) -> list[MatchCandidate]:
    """Rank posts by semantic similarity to a free-text query, descending.

    Returns [] immediately -- without touching the embedding backend -- for
    a blank/whitespace-only query or an empty candidate list.

    Raises ai.embedding.EmbeddingUnavailableError if the embedding backend
    can't be used; callers (UI) should catch this and show a friendly
    message instead of crashing.
    """
    query = (query or "").strip()
    if not query or not posts:
        return []

    query_vec = embedding.get_embedding(query)
    post_texts = [embedding.build_embedding_text(p) for p in posts]
    post_vecs = embedding.get_embeddings(post_texts)

    scored = [
        MatchCandidate(post=post, score=cosine_similarity(query_vec, vec))
        for post, vec in zip(posts, post_vecs)
    ]
    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:top_k]
