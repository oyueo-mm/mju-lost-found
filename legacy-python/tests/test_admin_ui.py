"""Exercises pages/7_관리자.py's access gate and report-processing UI via
Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- auth.require_admin(),
db.list_reports_for_admin(), db.process_report() -- runs against the real
db/database.py, so this proves the admin gate isn't UI-only.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

ROOT = Path(__file__).resolve().parent.parent
ADMIN_PAGE = str(ROOT / "pages" / "7_관리자.py")


class AdminUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_admin_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.reporter = db.create_user("reporter@mju.ac.kr", "신고자실명")
        self.target_user = db.create_user("target@mju.ac.kr", "대상실명")
        self.admin = db.create_user("admin@mju.ac.kr", "관리자실명")
        db.set_initial_nickname(self.reporter, "신고자닉")
        db.set_initial_nickname(self.target_user, "대상닉")
        db.set_initial_nickname(self.admin, "관리자닉")
        with db.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = db.create_lost_post(
            self.target_user, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.report_id = db.create_report(
            self.reporter, "post", self.lost_id, "사기/허위 정보", "가짜 같아요"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- access control ----------

    def test_anonymous_user_cannot_reach_admin_page(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(f"신고 #{self.report_id}" in str(m.value) for m in at.markdown))

    def test_non_admin_user_blocked_with_error(self):
        with patch("ui.auth.current_user_id", return_value=self.reporter):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("관리자만" in e for e in errors))
        self.assertFalse(any(f"신고 #{self.report_id}" in str(m.value) for m in at.markdown))

    def test_reported_target_user_also_blocked(self):
        """Being the reported-on user grants no admin access either -- this
        isn't a participant check, it's strictly the DB is_admin flag."""
        with patch("ui.auth.current_user_id", return_value=self.target_user):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("관리자만" in e.value for e in at.error))

    # ---------- admin can view/process ----------

    def test_admin_sees_report_list(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any(f"신고 #{self.report_id}" in str(m.value) for m in at.markdown))
        self.assertTrue(any("신고자닉" in str(c.value) for c in at.caption))

    def test_admin_can_dismiss_pending_report(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.report_id}").set_value("반려")
            at.button(key=f"admin_process_btn_{self.report_id}").click()
            at.run(timeout=30)
            at.button(key=f"admin_confirm_yes_{self.report_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        report = db.get_report(self.report_id)
        self.assertEqual(report["status"], "dismissed")
        self.assertEqual(report["processed_by_user_id"], self.admin)

    def test_processing_cancel_button_leaves_report_pending(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.button(key=f"admin_process_btn_{self.report_id}").click()
            at.run(timeout=30)
            at.button(key=f"admin_confirm_no_{self.report_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.get_report(self.report_id)["status"], "pending")

    def test_processed_report_disappears_from_default_pending_filter(self):
        db.process_report(self.report_id, self.admin, "dismissed")

        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)  # default filter is "처리 대기" (pending)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(f"신고 #{self.report_id}" in str(m.value) for m in at.markdown))
        self.assertTrue(any("조건에 맞는 신고가 없습니다" in str(i.value) for i in at.info))

    def test_deleted_target_shown_with_warning(self):
        db.delete_lost_post(self.lost_id, self.target_user)

        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("삭제되었습니다" in str(w.value) for w in at.warning))


if __name__ == "__main__":
    unittest.main()
