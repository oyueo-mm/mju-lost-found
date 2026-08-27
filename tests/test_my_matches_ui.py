"""Exercises pages/4_내_매칭.py via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment -- see the report) but everything downstream -- DB query,
ownership check, delete -- runs against the real db/database.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

MY_MATCHES_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "4_내_매칭.py")


class MyMatchesUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_my_matches_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "습득자")
        db.set_initial_nickname(self.lost_owner, "분실자닉")
        db.set_initial_nickname(self.found_owner, "습득자닉")
        self.lost_id = db.create_lost_post(
            self.lost_owner, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )
        self.match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_login_gate_blocks_anonymous_user(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))
        markdowns = [m.value for m in at.markdown]
        self.assertFalse(any("검은색 에어팟" in m for m in markdowns))

    def test_empty_state_shows_info_not_error(self):
        other_user = db.create_user("nomatch@mju.ac.kr", "매칭없음")
        db.set_initial_nickname(other_user, "매칭없음닉")
        with patch("ui.auth.current_user_id", return_value=other_user):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)
        infos = [i.value for i in at.info]
        self.assertTrue(any("확정된 매칭이 없습니다" in i for i in infos))

    def test_match_list_renders_for_lost_owner(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m and "검은색 무선 이어폰" in m for m in markdowns))
        captions = [c.value for c in at.caption]
        self.assertTrue(any("내가 분실자" in c for c in captions))
        self.assertTrue(any("AI 유사도 점수: 0.90" in c for c in captions))

    def test_match_list_renders_for_found_owner(self):
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("내가 습득자" in c for c in captions))

    def test_view_opposite_post_button_switches_page(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"match_goto_found_{self.match_id}").click()
                at.run(timeout=30)

        mock_switch.assert_called_once_with("pages/2_찾았어요.py")
        self.assertEqual(at.session_state["selected_found_id"], self.found_id)

    def test_cancel_requires_confirmation_step(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

            at.button(key=f"match_cancel_btn_{self.match_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        warnings = [w.value for w in at.warning]
        self.assertTrue(any("정말 매칭을 취소" in w for w in warnings))
        # match must NOT be deleted yet -- only the confirmation prompt shown
        self.assertIsNotNone(db.get_match(self.match_id))
        self.assertTrue(any(b.key == f"match_cancel_yes_{self.match_id}" for b in at.button))

    def test_cancel_confirm_deletes_match_and_disappears_from_list(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)
            at.button(key=f"match_cancel_btn_{self.match_id}").click()
            at.run(timeout=30)
            at.button(key=f"match_cancel_yes_{self.match_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertIsNone(db.get_match(self.match_id))
        # NOTE: st.success() is followed immediately by st.rerun(), so
        # AppTest's final captured state doesn't retain that transient
        # message (same known harness limitation noted in the AI-matching
        # report) -- success is instead verified via the DB state and the
        # match disappearing from the re-rendered list below.
        markdowns = [m.value for m in at.markdown]
        self.assertFalse(any("검은색 에어팟" in m for m in markdowns))
        infos = [i.value for i in at.info]
        self.assertTrue(any("확정된 매칭이 없습니다" in i for i in infos))

    def test_cancel_dismiss_keeps_match(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)
            at.button(key=f"match_cancel_btn_{self.match_id}").click()
            at.run(timeout=30)
            at.button(key=f"match_cancel_cancel_{self.match_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertIsNotNone(db.get_match(self.match_id))
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))

    def test_posts_and_their_status_untouched_after_cancel(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)
            at.button(key=f"match_cancel_btn_{self.match_id}").click()
            at.run(timeout=30)
            at.button(key=f"match_cancel_yes_{self.match_id}").click()
            at.run(timeout=30)

        lost_post = db.get_lost_post(self.lost_id)
        found_post = db.get_found_post(self.found_id)
        self.assertIsNotNone(lost_post)
        self.assertIsNotNone(found_post)
        self.assertEqual(lost_post["status"], "찾는 중")
        self.assertEqual(found_post["status"], "보관 중")


if __name__ == "__main__":
    unittest.main()
