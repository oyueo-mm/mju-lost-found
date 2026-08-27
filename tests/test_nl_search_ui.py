"""Exercises the "AI 의미 검색" mode added to pages/1_찾아요.py and
pages/2_찾았어요.py via Streamlit's AppTest. ai.search.search_similar_posts
is stubbed here for speed/determinism -- the real model is separately
validated in tests/test_search.py's RealModelSearchIntegrationTestCase.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from ai import embedding
from ai.matching import MatchCandidate
from db import database as db

LOST_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py")
FOUND_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "2_찾았어요.py")


class NaturalLanguageSearchUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_nl_search_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.uid = db.create_user("student@mju.ac.kr", "학생")
        db.set_initial_nickname(self.uid, "학생닉네임")
        self.lost_id = db.create_lost_post(
            self.uid, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.uid, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )

        # 게시판 전체가 로그인 필수로 바뀌었으므로, 목록/검색만 보는 테스트도
        # 로그인된 사용자를 가정해야 한다 (읽기 전용 화면이라도 예외 아님).
        self._auth_patcher = patch("ui.auth.current_user_id", return_value=self.uid)
        self._auth_patcher.start()

    def tearDown(self):
        self._auth_patcher.stop()
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def _switch_to_ai_mode(self, at, radio_key):
        at.radio(key=radio_key).set_value("AI 의미 검색")
        at.run(timeout=30)

    # ---------- 찾아요 board: AI search over FoundPost ----------

    def test_lost_board_ai_search_finds_found_posts(self):
        found_post = db.get_found_post(self.found_id)
        fake_result = [MatchCandidate(post=found_post, score=0.91)]

        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)
        self._switch_to_ai_mode(at, "lost_search_mode")

        at.text_input(key="lost_ai_query_input").set_value("검은색 에어팟을 도서관에서 잃어버렸어요")
        with patch("ai.search.search_similar_posts", return_value=fake_result) as mock_search:
            at.button(key="FormSubmitter:lost_search_form-검색").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_search.assert_called_once()
        called_query = mock_search.call_args[0][0]
        self.assertEqual(called_query, "검은색 에어팟을 도서관에서 잃어버렸어요")

        captions = [c.value for c in at.caption]
        self.assertTrue(any("AI 유사도 점수: 0.91" in c for c in captions))
        self.assertFalse(any("%" in c for c in captions if "유사도" in c))

    def test_lost_board_blank_ai_query_shows_warning_not_error(self):
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)
        self._switch_to_ai_mode(at, "lost_search_mode")

        at.text_input(key="lost_ai_query_input").set_value("   ")
        at.button(key="FormSubmitter:lost_search_form-검색").click()
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)
        warnings = [w.value for w in at.warning]
        self.assertTrue(any("검색어를 입력" in w for w in warnings))

    def test_lost_board_ai_search_model_unavailable_shows_error_not_crash(self):
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)
        self._switch_to_ai_mode(at, "lost_search_mode")

        at.text_input(key="lost_ai_query_input").set_value("검은색 에어팟을 도서관에서 잃어버렸어요")
        with patch(
            "ai.search.search_similar_posts",
            side_effect=embedding.EmbeddingUnavailableError("model not loaded"),
        ):
            at.button(key="FormSubmitter:lost_search_form-검색").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("AI 검색 기능을 사용할 수 없습니다" in e for e in errors))

    def test_lost_board_keyword_search_still_works(self):
        """Regression: existing keyword search must be unaffected."""
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)
        # default mode is already "키워드 검색"
        at.text_input(key="lost_keyword_input").set_value("에어팟")
        at.button(key="FormSubmitter:lost_search_form-검색").click()
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))

    # ---------- 찾았어요 board: AI search over LostPost ----------

    def test_found_board_ai_search_finds_lost_posts(self):
        lost_post = db.get_lost_post(self.lost_id)
        fake_result = [MatchCandidate(post=lost_post, score=0.88)]

        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)
        self._switch_to_ai_mode(at, "found_search_mode")

        at.text_input(key="found_ai_query_input").set_value("검은색 이어폰을 주웠어요")
        with patch("ai.search.search_similar_posts", return_value=fake_result) as mock_search:
            at.button(key="FormSubmitter:found_search_form-검색").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_search.assert_called_once()
        captions = [c.value for c in at.caption]
        self.assertTrue(any("AI 유사도 점수: 0.88" in c for c in captions))

    def test_found_board_keyword_search_still_works(self):
        """Regression: existing keyword search must be unaffected."""
        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)
        at.text_input(key="found_keyword_input").set_value("이어폰")
        at.button(key="FormSubmitter:found_search_form-검색").click()
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 무선 이어폰" in m for m in markdowns))


if __name__ == "__main__":
    unittest.main()
