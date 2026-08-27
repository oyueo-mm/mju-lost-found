"""Exercises the report system's UI wiring (pages/1,2's post report,
pages/5's message/user report) via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- db.create_report(), its
validation, duplicate/self-report rejection -- runs against the real
db/database.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

ROOT = Path(__file__).resolve().parent.parent
LOST_PAGE = str(ROOT / "pages" / "1_찾아요.py")
FOUND_PAGE = str(ROOT / "pages" / "2_찾았어요.py")
CHAT_PAGE = str(ROOT / "pages" / "5_채팅.py")


class ReportUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_report_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "분실자실명")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "습득자실명")
        db.set_initial_nickname(self.lost_owner, "분실자닉")
        db.set_initial_nickname(self.found_owner, "습득자닉")

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

    # ---------- post report ----------

    def test_post_report_ui_success(self):
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_detail_btn_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"report_btn_post_{self.lost_id}").click()
            at.run(timeout=30)
            at.selectbox(key=f"report_reason_post_{self.lost_id}").set_value("욕설/비방")
            at.button(key=f"FormSubmitter:report_form_post_{self.lost_id}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        reports = db.list_reports_by_reporter(self.found_owner)
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["target_type"], "post")
        self.assertEqual(reports[0]["target_id"], self.lost_id)
        self.assertEqual(reports[0]["reason"], "욕설/비방")

    def test_found_post_report_ui_success(self):
        # pages/2_찾았어요.py negates FoundPost ids for target_type="post"
        # (see db.create_report()) since LostPost/FoundPost ids commonly
        # collide (independent autoincrement sequences).
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(FOUND_PAGE)
            at.run(timeout=30)
            at.button(key=f"found_detail_btn_{self.found_id}").click()
            at.run(timeout=30)
            at.button(key=f"report_btn_post_{-self.found_id}").click()
            at.run(timeout=30)
            at.button(key=f"FormSubmitter:report_form_post_{-self.found_id}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        reports = db.list_reports_by_reporter(self.lost_owner)
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["target_id"], -self.found_id)

    def test_duplicate_post_report_shows_error(self):
        db.create_report(self.found_owner, "post", self.lost_id, "기타")

        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_detail_btn_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"report_btn_post_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"FormSubmitter:report_form_post_{self.lost_id}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("이미 신고한 대상" in e for e in errors))
        self.assertEqual(len(db.list_reports_by_reporter(self.found_owner)), 1)

    def test_own_post_has_no_working_report_path(self):
        """The owner viewing their own post detail sees the report button
        (UI doesn't special-case it), but submitting must still be rejected
        by db.create_report() itself -- proving validation isn't UI-only."""
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_detail_btn_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"report_btn_post_{self.lost_id}").click()
            at.run(timeout=30)
            at.button(key=f"FormSubmitter:report_form_post_{self.lost_id}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("자신이 작성한 게시물" in e for e in errors))
        self.assertEqual(db.list_reports_by_reporter(self.lost_owner), [])

    def test_anonymous_user_cannot_reach_report_ui(self):
        """Anonymous users are blocked by the existing login gate before the
        board (and its report button) ever renders."""
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(b.key and b.key.startswith("report_btn_") for b in at.button))

    # ---------- message report ----------

    def test_message_report_ui_success(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        room = db.get_or_create_chat_room(match_id, self.lost_owner)
        msg = db.send_message(room["id"], self.found_owner, "이거 제 물건 같아요!")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"report_btn_message_{msg['id']}").click()
            at.run(timeout=30)
            at.button(key=f"FormSubmitter:report_form_message_{msg['id']}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        reports = db.list_reports_by_reporter(self.lost_owner)
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["target_type"], "message")
        self.assertEqual(reports[0]["target_id"], msg["id"])

    def test_own_message_has_no_report_button(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        room = db.get_or_create_chat_room(match_id, self.lost_owner)
        my_msg = db.send_message(room["id"], self.lost_owner, "제가 보낸 메시지")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(
            any(b.key == f"report_btn_message_{my_msg['id']}" for b in at.button)
        )

    # ---------- user report ----------

    def test_user_report_ui_success_from_chat_page(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        room = db.get_or_create_chat_room(match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"report_btn_user_{self.found_owner}").click()
            at.run(timeout=30)
            at.selectbox(key=f"report_reason_user_{self.found_owner}").set_value("사기/허위 정보")
            at.button(key=f"FormSubmitter:report_form_user_{self.found_owner}-신고 제출").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        reports = db.list_reports_by_reporter(self.lost_owner)
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["target_type"], "user")
        self.assertEqual(reports[0]["target_id"], self.found_owner)


if __name__ == "__main__":
    unittest.main()
