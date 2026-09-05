"""Exercises pages/7_관리자.py's moderation-action UI (delete_post/
hide_message/suspend_user), and the suspension enforcement it produces on
pages/1,2/5, via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- auth.require_admin(),
db.apply_report_action(), db._require_not_suspended() -- runs against the
real db/database.py.
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
LOST_PAGE = str(ROOT / "pages" / "1_찾아요.py")
CHAT_PAGE = str(ROOT / "pages" / "5_채팅.py")


class ModerationUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_moderation_ui.db"
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
        self.found_id = db.create_found_post(
            self.target_user, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        self.room = db.get_or_create_chat_room(self.match_id, self.target_user)
        self.message = db.send_message(self.room["id"], self.target_user, "원본 메시지 내용")

        self.post_report_id = db.create_report(self.reporter, "post", self.lost_id, "사기/허위 정보")
        self.message_report_id = db.create_report(
            self.reporter, "message", self.message["id"], "욕설/비방"
        )
        self.user_report_id = db.create_report(self.reporter, "user", self.target_user, "기타")

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- access control (regression from the report-review step) ----------

    def test_anonymous_user_blocked_from_admin_page(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(f"신고 #{self.post_report_id}" in str(m.value) for m in at.markdown))

    def test_normal_user_blocked_from_admin_page(self):
        with patch("ui.auth.current_user_id", return_value=self.reporter):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("관리자만" in e.value for e in at.error))
        # no action controls (radio/selectbox for status choice) leaked either
        self.assertFalse(
            any(sb.key == f"admin_status_choice_{self.post_report_id}" for sb in at.selectbox)
        )

    # ---------- action controls appear per target_type ----------

    def test_admin_sees_action_ui_for_pending_reports(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertTrue(
            any(sb.key == f"admin_status_choice_{self.post_report_id}" for sb in at.selectbox)
        )

    def test_post_report_shows_delete_post_action_when_actioned_chosen(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.post_report_id}").set_value("조치 완료")
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("게시물 삭제" in str(c.value) for c in at.caption))

    def test_message_report_shows_hide_message_action_when_actioned_chosen(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key="admin_target_type_filter").set_value("메시지")
            at.selectbox(key="admin_status_filter").set_value("전체")
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.message_report_id}").set_value("조치 완료")
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("메시지 숨김" in str(c.value) for c in at.caption))

    def test_user_report_shows_suspend_duration_options_when_actioned_chosen(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key="admin_target_type_filter").set_value("사용자")
            at.selectbox(key="admin_status_filter").set_value("전체")
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.user_report_id}").set_value("조치 완료")
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertTrue(
            any(r.key == f"admin_suspend_duration_{self.user_report_id}" for r in at.radio)
        )
        radio = next(r for r in at.radio if r.key == f"admin_suspend_duration_{self.user_report_id}")
        self.assertEqual(set(radio.options), {"7일", "30일", "영구"})

    # ---------- confirm/cancel two-step flow ----------

    def test_cancelling_confirmation_applies_nothing(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.post_report_id}").set_value("조치 완료")
            at.run(timeout=30)
            at.button(key=f"admin_process_btn_{self.post_report_id}").click()
            at.run(timeout=30)
            at.button(key=f"admin_confirm_no_{self.post_report_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.get_report(self.post_report_id)["status"], "pending")
        self.assertIsNotNone(db.get_lost_post(self.lost_id))
        self.assertIsNone(db.get_moderation_action_for_report(self.post_report_id))

    def test_confirming_post_action_deletes_post_and_marks_actioned(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.post_report_id}").set_value("조치 완료")
            at.run(timeout=30)
            at.text_input(key=f"admin_action_reason_{self.post_report_id}").set_value("허위 게시물 확인됨")
            at.button(key=f"admin_process_btn_{self.post_report_id}").click()
            at.run(timeout=30)
            at.button(key=f"admin_confirm_yes_{self.post_report_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertIsNone(db.get_lost_post(self.lost_id))
        report = db.get_report(self.post_report_id)
        self.assertEqual(report["status"], "actioned")
        self.assertEqual(report["processed_by_user_id"], self.admin)
        ma = db.get_moderation_action_for_report(self.post_report_id)
        self.assertEqual(ma["action_type"], "delete_post")
        self.assertEqual(ma["reason"], "허위 게시물 확인됨")

    def test_confirming_user_action_suspends_with_chosen_duration(self):
        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key="admin_target_type_filter").set_value("사용자")
            at.selectbox(key="admin_status_filter").set_value("전체")
            at.run(timeout=30)
            at.selectbox(key=f"admin_status_choice_{self.user_report_id}").set_value("조치 완료")
            at.run(timeout=30)
            at.radio(key=f"admin_suspend_duration_{self.user_report_id}").set_value("7일")
            at.button(key=f"admin_process_btn_{self.user_report_id}").click()
            at.run(timeout=30)
            at.button(key=f"admin_confirm_yes_{self.user_report_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(db.is_user_suspended(self.target_user))
        ma = db.get_moderation_action_for_report(self.user_report_id)
        self.assertEqual(ma["action_type"], "suspend_user")
        self.assertIsNotNone(ma["expires_at"])

    # ---------- processed reports drop out of the pending filter ----------

    def test_actioned_report_disappears_from_pending_filter(self):
        db.apply_report_action(self.post_report_id, self.admin, "delete_post")

        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)  # default filter is 처리 대기 (pending)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(f"신고 #{self.post_report_id}" in str(m.value) for m in at.markdown))

    def test_deleted_post_still_shown_as_target_deleted_in_admin_list(self):
        db.apply_report_action(self.post_report_id, self.admin, "delete_post")

        with patch("ui.auth.current_user_id", return_value=self.admin):
            at = AppTest.from_file(ADMIN_PAGE)
            at.run(timeout=30)
            at.selectbox(key="admin_status_filter").set_value("조치 완료")
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("삭제되었습니다" in str(w.value) for w in at.warning))
        self.assertTrue(any("게시물 삭제" in str(w.value) for w in at.markdown))

    # ---------- effects observed from the normal (non-admin) UI ----------

    def test_hidden_message_shows_placeholder_in_chat_page(self):
        db.apply_report_action(self.message_report_id, self.admin, "hide_message")

        with patch("ui.auth.current_user_id", return_value=self.target_user):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        page_text = " ".join(str(w.value) for w in at.markdown) + " ".join(
            str(c.value) for c in at.caption
        )
        self.assertNotIn("원본 메시지 내용", page_text)
        self.assertIn(db.HIDDEN_MESSAGE_PLACEHOLDER, page_text)

    def test_suspended_user_cannot_create_new_post_from_ui(self):
        db.apply_report_action(self.user_report_id, self.admin, "suspend_user")

        with patch("ui.auth.current_user_id", return_value=self.target_user):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            # text_input order on the page: [0] search keyword (tab_list),
            # [1] title, [2] location (tab_new) -- description is a text_area.
            at.text_input[1].set_value("정지 중 작성 시도")
            at.text_area[0].set_value("설명")
            at.text_input[2].set_value("장소")
            at.button(key="FormSubmitter:lost_new_form-등록하기").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any(db.SUSPENDED_ACCOUNT_MESSAGE in e.value for e in at.error))
        self.assertEqual(len(db.list_lost_posts_by_user(self.target_user)), 1)  # only the original


if __name__ == "__main__":
    unittest.main()
