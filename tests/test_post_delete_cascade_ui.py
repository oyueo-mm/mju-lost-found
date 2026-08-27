"""Verifies that deleting a post with a confirmed Match, via the real
pages/3_내_게시물.py delete flow, cascades cleanly:
- no sqlite3.IntegrityError bubbles up to the UI
- the post disappears from "내 게시물"
- the Match disappears from list_matches_by_user() (i.e. from "내 매칭",
  which is left untouched per the task -- CASCADE is enough)
- the *other* post in the match is untouched
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

MY_POSTS_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "3_내_게시물.py")


class PostDeleteCascadeUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_post_delete_cascade_ui.db"
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

    def test_deleting_lost_post_with_a_match_succeeds_without_integrity_error(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_POSTS_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_delete_btn_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"lost_delete_yes_{self.lost_id}").click()
            at.run(timeout=30)

        # No IntegrityError (or any other exception) should have surfaced.
        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)

        # Post itself is gone.
        self.assertIsNone(db.get_lost_post(self.lost_id))
        markdowns = [m.value for m in at.markdown]
        self.assertFalse(any("검은색 에어팟" in m for m in markdowns))

        # The Match was cascade-deleted, so it no longer shows up for either side.
        self.assertIsNone(db.get_match(self.match_id))
        self.assertEqual(db.list_matches_by_user(self.lost_owner), [])
        self.assertEqual(db.list_matches_by_user(self.found_owner), [])

        # The other side's post is untouched.
        self.assertIsNotNone(db.get_found_post(self.found_id))

    def test_deleting_found_post_with_a_match_succeeds_without_integrity_error(self):
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(MY_POSTS_PAGE)
            at.run(timeout=30)
            at.button(key=f"found_delete_btn_{self.found_id}").click()
            at.run(timeout=30)
            at.button(key=f"found_delete_yes_{self.found_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)

        self.assertIsNone(db.get_found_post(self.found_id))
        markdowns = [m.value for m in at.markdown]
        self.assertFalse(any("검은색 무선 이어폰" in m for m in markdowns))

        self.assertIsNone(db.get_match(self.match_id))
        self.assertEqual(db.list_matches_by_user(self.lost_owner), [])
        self.assertEqual(db.list_matches_by_user(self.found_owner), [])

        self.assertIsNotNone(db.get_lost_post(self.lost_id))


if __name__ == "__main__":
    unittest.main()
