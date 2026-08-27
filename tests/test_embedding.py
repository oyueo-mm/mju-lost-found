import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai import embedding


class BuildEmbeddingTextTestCase(unittest.TestCase):
    """Pure text-assembly logic, no model needed."""

    def test_combines_all_fields(self):
        post = {
            "title": "검은색 에어팟",
            "description": "케이스에 흰색 스티커",
            "category": "전자기기",
            "location": "인문캠퍼스 도서관",
        }
        text = embedding.build_embedding_text(post)
        for field in post.values():
            self.assertIn(field, text)

    def test_skips_missing_or_empty_fields(self):
        post = {"title": "검은색 에어팟", "description": "", "category": None, "location": "도서관"}
        text = embedding.build_embedding_text(post)
        self.assertEqual(text, "검은색 에어팟 도서관")

    def test_works_with_dict_lacking_some_keys(self):
        post = {"title": "검은색 에어팟"}
        text = embedding.build_embedding_text(post)
        self.assertEqual(text, "검은색 에어팟")


class GracefulFailureTestCase(unittest.TestCase):
    """Simulates the model backend being unavailable (e.g. not installed, or
    the download failing with no network) and checks the app-facing surface
    (is_available/get_embedding/get_embeddings) degrades cleanly instead of
    raising an uncaught/raw exception."""

    def test_is_available_false_when_model_fails_to_load(self):
        with patch.object(
            embedding, "_get_model", side_effect=embedding.EmbeddingUnavailableError("boom")
        ):
            self.assertFalse(embedding.is_available())

    def test_get_embedding_raises_typed_error_not_raw_exception(self):
        with patch.object(
            embedding, "_get_model", side_effect=embedding.EmbeddingUnavailableError("boom")
        ):
            with self.assertRaises(embedding.EmbeddingUnavailableError):
                embedding.get_embedding("아무 텍스트")

    def test_get_embeddings_raises_typed_error_not_raw_exception(self):
        with patch.object(
            embedding, "_get_model", side_effect=embedding.EmbeddingUnavailableError("boom")
        ):
            with self.assertRaises(embedding.EmbeddingUnavailableError):
                embedding.get_embeddings(["텍스트1", "텍스트2"])

    def test_missing_sentence_transformers_package_is_reported_clearly(self):
        embedding._model = None
        embedding._load_error = None
        try:
            with patch.dict(sys.modules, {"sentence_transformers": None}):
                with self.assertRaises(embedding.EmbeddingUnavailableError) as ctx:
                    embedding._get_model()
            self.assertIn("pip install", str(ctx.exception))
        finally:
            embedding._model = None
            embedding._load_error = None


class RealModelIntegrationTestCase(unittest.TestCase):
    """Actually loads the configured embedding model and checks that
    semantically related Korean sentences score higher than unrelated ones.

    Skipped (not failed) if the model/backend isn't available -- e.g. no
    network on first run, or sentence-transformers not installed -- so the
    rest of the suite stays runnable without the heavy AI dependency.
    """

    @classmethod
    def setUpClass(cls):
        if not embedding.is_available():
            raise unittest.SkipTest(
                "embedding model not available (not installed or download failed)"
            )

    def test_semantically_similar_sentences_score_higher_than_unrelated(self):
        from ai.matching import cosine_similarity

        airpods = embedding.get_embedding("검은색 에어팟을 도서관에서 잃어버렸어요")
        earphones = embedding.get_embedding("검은색 무선 이어폰을 도서관에서 주웠습니다")
        umbrella = embedding.get_embedding("파란색 우산을 학생회관에서 주웠어요")

        related_score = cosine_similarity(airpods, earphones)
        unrelated_score = cosine_similarity(airpods, umbrella)

        self.assertGreater(related_score, unrelated_score)

    def test_get_embeddings_batch_matches_single_encode(self):
        texts = ["검은색 에어팟", "파란색 우산"]
        batch = embedding.get_embeddings(texts)
        self.assertEqual(batch.shape[0], 2)

        single = embedding.get_embedding(texts[0])
        # batch and single-item encoding should agree closely
        from ai.matching import cosine_similarity

        self.assertGreater(cosine_similarity(batch[0], single), 0.99)


if __name__ == "__main__":
    unittest.main()
