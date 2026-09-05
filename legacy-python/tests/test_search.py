import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai import embedding, search

# Hand-crafted "embeddings" for test sentences: no real model needed, so this
# validates the search/ranking logic in isolation from the model.
_FAKE_VECTORS = {
    "검은색 에어팟을 도서관에서 잃어버렸어요": np.array([1.0, 0.0, 0.0]),
    "검은색 무선 이어폰 인문캠퍼스 도서관": np.array([0.95, 0.05, 0.0]),  # closely related
    "AirPods Pro 2 도서관 열람실": np.array([0.7, 0.3, 0.0]),  # loosely related
    "파란색 3단 우산 학생회관": np.array([0.0, 1.0, 0.0]),  # unrelated
    "검정 반지갑 학생회관": np.array([0.0, 0.0, 1.0]),  # unrelated
}


def _fake_get_embedding(text: str) -> np.ndarray:
    return _FAKE_VECTORS[text]


def _fake_get_embeddings(texts: list[str]) -> np.ndarray:
    return np.array([_FAKE_VECTORS[t] for t in texts])


class SearchSimilarPostsTestCase(unittest.TestCase):
    """Uses plain dicts (not real DB rows) and a stubbed embedding backend."""

    def setUp(self):
        self.earphones = {"title": "검은색 무선 이어폰", "description": "", "category": "", "location": "인문캠퍼스 도서관"}
        self.airpods_pro = {"title": "AirPods Pro 2", "description": "", "category": "", "location": "도서관 열람실"}
        self.umbrella = {"title": "파란색 3단 우산", "description": "", "category": "", "location": "학생회관"}
        self.wallet = {"title": "검정 반지갑", "description": "", "category": "", "location": "학생회관"}

        self._text_by_title = {
            "검은색 무선 이어폰": "검은색 무선 이어폰 인문캠퍼스 도서관",
            "AirPods Pro 2": "AirPods Pro 2 도서관 열람실",
            "파란색 3단 우산": "파란색 3단 우산 학생회관",
            "검정 반지갑": "검정 반지갑 학생회관",
        }
        self._query = "검은색 에어팟을 도서관에서 잃어버렸어요"

    def _patched(self):
        return patch.multiple(
            "ai.embedding",
            build_embedding_text=lambda post: self._text_by_title[post["title"]],
            get_embedding=_fake_get_embedding,
            get_embeddings=_fake_get_embeddings,
        )

    def test_semantically_similar_post_ranks_first(self):
        candidates = [self.umbrella, self.earphones, self.wallet]
        with self._patched():
            results = search.search_similar_posts(self._query, candidates)

        self.assertEqual(results[0].post["title"], "검은색 무선 이어폰")

    def test_unrelated_posts_rank_lowest(self):
        candidates = [self.earphones, self.airpods_pro, self.umbrella, self.wallet]
        with self._patched():
            results = search.search_similar_posts(self._query, candidates)

        ranked_titles = [r.post["title"] for r in results]
        self.assertEqual(ranked_titles[-1], "검정 반지갑")
        self.assertEqual(ranked_titles[-2], "파란색 3단 우산")

    def test_scores_are_descending(self):
        candidates = [self.wallet, self.earphones, self.umbrella, self.airpods_pro]
        with self._patched():
            results = search.search_similar_posts(self._query, candidates)

        scores = [r.score for r in results]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_top_k_limits_result_count(self):
        candidates = [self.earphones, self.airpods_pro, self.umbrella, self.wallet]
        with self._patched():
            results = search.search_similar_posts(self._query, candidates, top_k=2)
        self.assertEqual(len(results), 2)

    def test_empty_candidate_list_returns_empty_without_calling_model(self):
        with self._patched():
            results = search.search_similar_posts(self._query, [])
        self.assertEqual(results, [])

    def test_blank_query_returns_empty_without_calling_model(self):
        candidates = [self.earphones, self.umbrella]
        with patch("ai.embedding.get_embedding", side_effect=AssertionError("should not be called")):
            self.assertEqual(search.search_similar_posts("", candidates), [])
            self.assertEqual(search.search_similar_posts("   ", candidates), [])
            self.assertEqual(search.search_similar_posts(None, candidates), [])

    def test_embedding_unavailable_propagates_typed_error(self):
        candidates = [self.earphones]
        with patch(
            "ai.embedding.get_embedding",
            side_effect=embedding.EmbeddingUnavailableError("model not loaded"),
        ):
            with self.assertRaises(embedding.EmbeddingUnavailableError):
                search.search_similar_posts(self._query, candidates)


class RealModelSearchIntegrationTestCase(unittest.TestCase):
    """Runs the actual configured embedding model. Skipped (not failed) if
    it isn't available in this environment (not installed / download failed)."""

    @classmethod
    def setUpClass(cls):
        if not embedding.is_available():
            raise unittest.SkipTest(
                "embedding model not available (not installed or download failed)"
            )

    def test_natural_language_query_ranks_semantically_close_post_first(self):
        posts = [
            {"title": "파란색 3단 우산", "description": "자동으로 펴지는 우산", "category": "기타", "location": "학생회관"},
            {"title": "검은색 무선 이어폰", "description": "케이스에 흰색 스티커가 있어요", "category": "전자기기", "location": "인문캠퍼스 도서관"},
            {"title": "검정 반지갑", "description": "카드 여러 장 들어있음", "category": "지갑", "location": "학생회관"},
        ]
        query = "검은색 에어팟을 도서관에서 잃어버렸어요. 케이스에 흰색 스티커가 붙어 있어요."

        results = search.search_similar_posts(query, posts, top_k=3)

        self.assertEqual(len(results), 3)
        self.assertEqual(results[0].post["title"], "검은색 무선 이어폰")
        scores = [r.score for r in results]
        self.assertEqual(scores, sorted(scores, reverse=True))


if __name__ == "__main__":
    unittest.main()
