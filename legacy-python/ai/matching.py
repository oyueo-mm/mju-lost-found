"""Semantic similarity matching between LostPost and FoundPost candidates.

MVP scope: brute-force over all candidates (no vector index / DB). Callers
supply the candidate list themselves (e.g. from db.list_found_posts()) --
this module never queries the DB directly, so it stays testable with plain
dicts and independent of the DB schema evolving.

This module does not write to the Match table. Persisting a chosen match is
the caller's decision (db.create_match(lost_post_id, found_post_id, score,
requesting_user_id) already covers it, including ownership checks and
duplicate-safe get-or-create behavior) -- see the project report for why
persistence stays a separate, explicit step.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from ai import embedding

DEFAULT_TOP_K = 3


@dataclass
class MatchCandidate:
    post: Any  # sqlite3.Row or dict of the candidate LostPost/FoundPost
    score: float  # cosine similarity, roughly in [-1, 1]


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """Cosine similarity between two vectors. Returns 0.0 for a zero vector
    (undefined direction) instead of raising a division-by-zero error."""
    a = np.asarray(vec_a, dtype=np.float32)
    b = np.asarray(vec_b, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def rank_similar_posts(
    target_post: Any, candidate_posts: list[Any], top_k: int = DEFAULT_TOP_K
) -> list[MatchCandidate]:
    """Rank candidate_posts by semantic similarity to target_post, descending.

    target_post / each item in candidate_posts must be subscriptable with
    "title", "description", "category", "location" (sqlite3.Row or dict).

    Raises ai.embedding.EmbeddingUnavailableError if the embedding backend
    can't be used -- callers (UI) should catch this and show a friendly
    message instead of crashing.
    """
    if not candidate_posts:
        return []

    target_vec = embedding.get_embedding(embedding.build_embedding_text(target_post))
    candidate_texts = [embedding.build_embedding_text(p) for p in candidate_posts]
    candidate_vecs = embedding.get_embeddings(candidate_texts)

    scored = [
        MatchCandidate(post=post, score=cosine_similarity(target_vec, vec))
        for post, vec in zip(candidate_posts, candidate_vecs)
    ]
    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:top_k]


def find_similar_found_posts(
    lost_post: Any, found_posts: list[Any], top_k: int = DEFAULT_TOP_K
) -> list[MatchCandidate]:
    """Given a LostPost, rank FoundPost candidates by semantic similarity."""
    return rank_similar_posts(lost_post, found_posts, top_k)


def find_similar_lost_posts(
    found_post: Any, lost_posts: list[Any], top_k: int = DEFAULT_TOP_K
) -> list[MatchCandidate]:
    """Given a FoundPost, rank LostPost candidates by semantic similarity."""
    return rank_similar_posts(found_post, lost_posts, top_k)
