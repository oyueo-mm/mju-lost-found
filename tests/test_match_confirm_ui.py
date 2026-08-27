"""Exercises the "내 물건 같아요" Match-confirmation UI on the AI matching
result cards, via Streamlit's AppTest against the real page scripts.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment -- see the report) but everything downstream -- ownership check,
duplicate prevention, DB write -- runs against the real db/database.py.
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


class MatchConfirmUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_match_confirm_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "습득자")
        self.stranger = db.create_user("stranger@mju.ac.kr", "제3자")
        db.set_initial_nickname(self.lost_owner, "분실자닉")
        db.set_initial_nickname(self.found_owner, "습득자닉")
        db.set_initial_nickname(self.stranger, "제3자닉")

        self.lost_id = db.create_lost_post(
            self.lost_owner, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def _open_lost_detail_with_ai_matches(self, at):
        at.run(timeout=30)
        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)
        at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
        at.run(timeout=30)

    def _open_found_detail_with_ai_matches(self, at):
        at.run(timeout=30)
        at.button(key=f"found_detail_btn_{self.found_id}").click()
        at.run(timeout=30)
        at.button(key=f"ai_match_btn_lost_{self.found_id}").click()
        at.run(timeout=30)

    # ---------- 찾아요 board: confirm as LostPost owner ----------

    def test_lost_owner_can_confirm_match_with_found_candidate(self):
        with patch("ui.common.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            self._open_lost_detail_with_ai_matches(at)

            confirm_btn = next(b for b in at.button if b.key and b.key.startswith("confirm_match_"))
            confirm_btn.click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        match = db.get_match_by_posts(self.lost_id, self.found_id)
        self.assertIsNotNone(match)
        captions = [c.value for c in at.caption]
        self.assertTrue(any("매칭이 확정되었습니다" in c for c in captions))
        # no leftover "내 물건 같아요" button once confirmed
        self.assertFalse(any(b.key and b.key.startswith("confirm_match_") for b in at.button))

    def test_stranger_cannot_confirm_match_from_lost_board(self):
        """A user who owns neither post must be rejected at the DB layer,
        not merely have the button hidden -- so we call create_match directly
        the way a UI bypass / crafted request would."""
        with self.assertRaises(db.PermissionDeniedError):
            db.create_match(self.lost_id, self.found_id, 0.9, self.stranger)
        self.assertIsNone(db.get_match_by_posts(self.lost_id, self.found_id))

    def test_duplicate_confirm_shows_already_matched_not_error(self):
        db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)

        with patch("ui.common.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            self._open_lost_detail_with_ai_matches(at)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.error), 0)
        captions = [c.value for c in at.caption]
        self.assertTrue(any("이미 매칭된 게시물입니다" in c for c in captions))
        self.assertFalse(any(b.key and b.key.startswith("confirm_match_") for b in at.button))
        self.assertEqual(len(db.list_matches_for_lost_post(self.lost_id)), 1)

    def test_score_saved_matches_ai_matching_score(self):
        with patch("ui.common.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            self._open_lost_detail_with_ai_matches(at)

            shown_caption = next(
                c.value for c in at.caption if c.value.startswith("AI 유사도 점수:")
            )
            shown_score = float(shown_caption.split(":")[1].split("(")[0].strip())

            confirm_btn = next(b for b in at.button if b.key and b.key.startswith("confirm_match_"))
            confirm_btn.click()
            at.run(timeout=30)

        stored_score = db.get_match_by_posts(self.lost_id, self.found_id)["score"]
        # shown_caption is rounded to 2 decimals; stored value must match to that precision
        self.assertAlmostEqual(stored_score, shown_score, places=2)

    # ---------- 찾았어요 board: confirm as FoundPost owner ----------

    def test_found_owner_can_confirm_match_with_lost_candidate(self):
        with patch("ui.common.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(FOUND_PAGE)
            self._open_found_detail_with_ai_matches(at)

            confirm_btn = next(b for b in at.button if b.key and b.key.startswith("confirm_match_"))
            confirm_btn.click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertIsNotNone(db.get_match_by_posts(self.lost_id, self.found_id))
        captions = [c.value for c in at.caption]
        self.assertTrue(any("매칭이 확정되었습니다" in c for c in captions))

    def test_stranger_cannot_confirm_match_from_found_board(self):
        with self.assertRaises(db.PermissionDeniedError):
            db.create_match(self.lost_id, self.found_id, 0.9, self.stranger)

    def test_not_logged_in_blocked_from_entire_board_not_just_confirm_button(self):
        """Boards now require login end-to-end (no more anonymous browsing),
        so a logged-out visitor never even reaches the post list/detail or
        the AI match section -- they see only the login-required notice."""
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))
        self.assertFalse(any(b.key and b.key.startswith("confirm_match_") for b in at.button))
        self.assertFalse(any("검은색 무선 이어폰" in m.value for m in at.markdown))


if __name__ == "__main__":
    unittest.main()
