"""Verifies the "전체 로그인 필수화" policy: pages/1_찾아요.py and
pages/2_찾았어요.py used to allow anonymous browsing (list/detail/AI search)
and only gated registration. They now require login for the entire page,
matching pages/3_내_게시물.py through pages/6_내_채팅.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

LOST_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py")
FOUND_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "2_찾았어요.py")


class LoginRequiredUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_login_required_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.uid = db.create_user("student@mju.ac.kr", "학생")
        db.set_initial_nickname(self.uid, "학생닉네임")
        self.lost_id = db.create_lost_post(
            self.uid, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.uid, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_lost_board_blocks_anonymous_user_entirely(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))
        # no tabs, no post list, no search form -- the whole board is hidden
        self.assertEqual(len(at.tabs), 0)
        self.assertFalse(any("검은색 에어팟" in m.value for m in at.markdown))

    def test_found_board_blocks_anonymous_user_entirely(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(FOUND_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))
        self.assertEqual(len(at.tabs), 0)
        self.assertFalse(any("검은색 무선 이어폰" in m.value for m in at.markdown))

    def test_lost_board_accessible_once_logged_in(self):
        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))

    def test_found_board_accessible_once_logged_in(self):
        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(FOUND_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 무선 이어폰" in m for m in markdowns))


if __name__ == "__main__":
    unittest.main()
