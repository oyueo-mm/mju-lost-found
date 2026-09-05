"""Exercises the "AI로 유사한 OO 찾기" UI wiring on the real page scripts via
Streamlit's AppTest. The embedding/matching functions are stubbed here so
these run fast and deterministically without needing the real model -- the
real model is separately validated in tests/test_embedding.py and by the
manual end-to-end check described in the report.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from ai.matching import MatchCandidate
from db import database as db
from ai import embedding


class AiMatchUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_ai_match_ui.db"
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

        # 게시판 전체가 로그인 필수로 바뀌었으므로, 목록/상세만 보는 테스트도
        # 로그인된 사용자를 가정해야 한다.
        self._auth_patcher = patch("ui.auth.current_user_id", return_value=self.uid)
        self._auth_patcher.start()

    def tearDown(self):
        self._auth_patcher.stop()
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_lost_detail_shows_ai_match_button_and_results(self):
        found_post = db.get_found_post(self.found_id)
        fake_result = [MatchCandidate(post=found_post, score=0.87)]

        at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py"))
        at.run(timeout=30)

        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)

        with patch("ai.matching.find_similar_found_posts", return_value=fake_result):
            at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("AI 유사도 점수: 0.87" in c for c in captions))
        # score must not be presented as a percentage/probability
        self.assertFalse(any("%" in c for c in captions if "유사도" in c))

    def test_no_candidates_shows_friendly_message_not_error(self):
        at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py"))
        at.run(timeout=30)
        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)

        with patch("ai.matching.find_similar_found_posts", return_value=[]):
            at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)
        infos = [i.value for i in at.info]
        self.assertTrue(any("유사한" in i for i in infos))

    def test_embedding_unavailable_shows_error_not_crash(self):
        at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py"))
        at.run(timeout=30)
        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)

        with patch(
            "ai.matching.find_similar_found_posts",
            side_effect=embedding.EmbeddingUnavailableError("model not loaded"),
        ):
            at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("AI 매칭 기능을 사용할 수 없습니다" in e for e in errors))

    def test_result_detail_button_switches_page_to_found_board(self):
        found_post = db.get_found_post(self.found_id)
        fake_result = [MatchCandidate(post=found_post, score=0.87)]

        at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py"))
        at.run(timeout=30)
        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)

        with patch("ai.matching.find_similar_found_posts", return_value=fake_result):
            at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
            at.run(timeout=30)

        goto_key = f"ai_match_goto_found_{self.found_id}"
        with patch("streamlit.switch_page") as mock_switch:
            at.button(key=goto_key).click()
            at.run(timeout=30)

        mock_switch.assert_called_once_with("pages/2_찾았어요.py")
        self.assertEqual(at.session_state["selected_found_id"], self.found_id)

    def test_found_detail_mirrors_lost_search_direction(self):
        lost_post = db.get_lost_post(self.lost_id)
        fake_result = [MatchCandidate(post=lost_post, score=0.75)]

        at = AppTest.from_file(str(Path(__file__).resolve().parent.parent / "pages" / "2_찾았어요.py"))
        at.run(timeout=30)
        at.button(key=f"found_detail_btn_{self.found_id}").click()
        at.run(timeout=30)

        with patch("ai.matching.find_similar_lost_posts", return_value=fake_result):
            at.button(key=f"ai_match_btn_lost_{self.found_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("AI 유사도 점수: 0.75" in c for c in captions))


if __name__ == "__main__":
    unittest.main()
