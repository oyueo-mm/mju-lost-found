import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai import matching


class CosineSimilarityTestCase(unittest.TestCase):
    """Pure math, no model/DB involved."""

    def test_identical_vectors_score_one(self):
        v = np.array([1.0, 2.0, 3.0])
        self.assertAlmostEqual(matching.cosine_similarity(v, v), 1.0, places=6)

    def test_opposite_vectors_score_minus_one(self):
        v = np.array([1.0, 0.0])
        self.assertAlmostEqual(matching.cosine_similarity(v, -v), -1.0, places=6)

    def test_orthogonal_vectors_score_zero(self):
        a = np.array([1.0, 0.0])
        b = np.array([0.0, 1.0])
        self.assertAlmostEqual(matching.cosine_similarity(a, b), 0.0, places=6)

    def test_zero_vector_does_not_raise_and_scores_zero(self):
        zero = np.array([0.0, 0.0, 0.0])
        other = np.array([1.0, 2.0, 3.0])
        self.assertEqual(matching.cosine_similarity(zero, other), 0.0)
        self.assertEqual(matching.cosine_similarity(zero, zero), 0.0)

    def test_scale_invariant(self):
        a = np.array([1.0, 2.0, 3.0])
        b = np.array([2.0, 4.0, 6.0])  # same direction, different magnitude
        self.assertAlmostEqual(matching.cosine_similarity(a, b), 1.0, places=6)


# Hand-crafted "embeddings" for test sentences: no real model or GPU needed,
# so this validates the ranking/ordering logic in isolation from the model.
_FAKE_VECTORS = {
    "검은색 에어팟 인문캠퍼스 도서관": np.array([1.0, 0.0, 0.0]),
    "검은색 무선 이어폰 인문캠퍼스 도서관": np.array([0.9, 0.1, 0.0]),  # close to airpods
    "파란색 우산 자연캠퍼스": np.array([0.0, 1.0, 0.0]),  # unrelated
    "검정 지갑 학생회관": np.array([0.0, 0.0, 1.0]),  # unrelated
}


def _fake_get_embedding(text: str) -> np.ndarray:
    return _FAKE_VECTORS[text]


def _fake_get_embeddings(texts: list[str]) -> np.ndarray:
    return np.array([_FAKE_VECTORS[t] for t in texts])


class RankSimilarPostsTestCase(unittest.TestCase):
    """Uses plain dicts (not real DB rows) and a stubbed embedding backend,
    per the "test with synthetic sentences, not real post data" requirement."""

    def setUp(self):
        self.lost_airpods = {
            "title": "검은색 에어팟",
            "description": "",
            "category": "",
            "location": "",
        }
        self.found_earphones = {
            "title": "검은색 무선 이어폰",
            "description": "",
            "category": "",
            "location": "",
        }
        self.found_umbrella = {
            "title": "파란색 우산",
            "description": "",
            "category": "",
            "location": "",
        }
        self.found_wallet = {
            "title": "검정 지갑",
            "description": "",
            "category": "",
            "location": "",
        }

        # build_embedding_text joins title/description/category/location with
        # spaces and drops empty fields, so with only "title" set the result
        # is just the title text -- match that in _FAKE_VECTORS.
        self.text_by_post_title = {
            "검은색 에어팟": "검은색 에어팟 인문캠퍼스 도서관",
            "검은색 무선 이어폰": "검은색 무선 이어폰 인문캠퍼스 도서관",
            "파란색 우산": "파란색 우산 자연캠퍼스",
            "검정 지갑": "검정 지갑 학생회관",
        }

    def _patched(self):
        return patch.multiple(
            "ai.embedding",
            build_embedding_text=lambda post: self.text_by_post_title[post["title"]],
            get_embedding=_fake_get_embedding,
            get_embeddings=_fake_get_embeddings,
        )

    def test_find_similar_found_posts_ranks_semantically_closest_first(self):
        candidates = [self.found_umbrella, self.found_earphones, self.found_wallet]
        with self._patched():
            results = matching.find_similar_found_posts(self.lost_airpods, candidates)

        self.assertEqual(len(results), 3)
        self.assertEqual(results[0].post["title"], "검은색 무선 이어폰")
        self.assertGreater(results[0].score, results[1].score)
        self.assertGreater(results[0].score, results[2].score)

    def test_find_similar_lost_posts_is_the_reverse_direction(self):
        lost_candidates = [self.lost_airpods]
        with self._patched():
            results = matching.find_similar_lost_posts(self.found_earphones, lost_candidates)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].post["title"], "검은색 에어팟")
        self.assertGreater(results[0].score, 0.9)

    def test_top_k_limits_result_count(self):
        candidates = [self.found_earphones, self.found_umbrella, self.found_wallet]
        with self._patched():
            results = matching.find_similar_found_posts(self.lost_airpods, candidates, top_k=1)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].post["title"], "검은색 무선 이어폰")

    def test_no_candidates_returns_empty_list_without_calling_model(self):
        with self._patched():
            results = matching.find_similar_found_posts(self.lost_airpods, [])
        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
