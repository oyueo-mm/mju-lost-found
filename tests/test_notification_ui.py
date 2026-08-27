"""Exercises pages/8_알림.py (access gate, list, read/mark-all-read, click
routing) via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- auth.require_ready_user(),
db.list_notifications_by_user(), db.mark_notification_as_read(), etc. --
runs against the real db/database.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

ROOT = Path(__file__).resolve().parent.parent
NOTIF_PAGE = str(ROOT / "pages" / "8_알림.py")
CHAT_PAGE = str(ROOT / "pages" / "5_채팅.py")
MATCH_PAGE = str(ROOT / "pages" / "4_내_매칭.py")


class NotificationUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_notification_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.userA = db.create_user("usera@mju.ac.kr", "사용자A실명")
        self.userB = db.create_user("userb@mju.ac.kr", "사용자B실명")
        db.set_initial_nickname(self.userA, "사용자A닉")
        db.set_initial_nickname(self.userB, "사용자B닉")

        self.lost_id = db.create_lost_post(
            self.userA, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.userB, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- access control ----------

    def test_anonymous_user_blocked(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertFalse(any("읽지 않은 알림" in str(s.value) for s in at.subheader))

    def test_user_without_nickname_blocked(self):
        no_nick_user = db.create_user("nonick@mju.ac.kr", "닉네임없음")
        with patch("ui.auth.current_user_id", return_value=no_nick_user):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
        self.assertEqual(list(at.exception), [])
        self.assertFalse(any("읽지 않은 알림" in str(s.value) for s in at.subheader))
        # nickname setup form shown instead
        self.assertTrue(any(ti.label == "닉네임" for ti in at.text_input))

    # ---------- list / unread count ----------

    def test_notification_list_and_unread_count_displayed(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.userA)

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("읽지 않은 알림 1개" in str(s.value) for s in at.subheader))
        self.assertTrue(any("새로운 매칭이 성립되었습니다" in str(m.value) for m in at.markdown))

    def test_empty_notification_state(self):
        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("읽지 않은 알림 0개" in str(s.value) for s in at.subheader))
        self.assertTrue(any("알림이 없습니다" in str(i.value) for i in at.info))

    # ---------- own-only visibility ----------

    def test_only_own_notifications_shown(self):
        db.create_match(self.lost_id, self.found_id, 0.9, self.userA)  # notifies both A and B

        other_lost = db.create_lost_post(
            self.userA, "다른 지갑", "설명", "지갑", "학생회관", "2026-08-26 09:00"
        )
        other_user = db.create_user("userc@mju.ac.kr", "사용자C실명")
        db.set_initial_nickname(other_user, "사용자C닉")
        other_found = db.create_found_post(
            other_user, "다른 습득 지갑", "설명", "지갑", "학생회관", "2026-08-26 10:00"
        )
        db.create_match(other_lost, other_found, 0.7, self.userA)  # A + C only, not B

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # only 1 unread (B's own match notification), not C's
        self.assertTrue(any("읽지 않은 알림 1개" in str(s.value) for s in at.subheader))

    # ---------- read / mark-all-read ----------

    def test_confirm_marks_notification_read(self):
        report_id = db.create_report(self.userB, "user", self.userA, "기타")
        admin = db.create_user("admin@mju.ac.kr", "관리자실명")
        db.set_initial_nickname(admin, "관리자닉")
        with db.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (admin,))
        db.apply_report_action(report_id, admin, "suspend_user")  # notifies userA

        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            n = db.list_notifications_by_user(self.userA)[0]
            at.button(key=f"notif_confirm_{n['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.get_notification(n["id"])["is_read"], 1)

    def test_mark_all_as_read(self):
        db.create_match(self.lost_id, self.found_id, 0.9, self.userA)

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            at.button(key="notif_mark_all_read").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.count_unread_notifications(self.userB), 0)

    # ---------- IDOR: can't touch another user's notification via a manipulated key ----------

    def test_cannot_mark_another_users_notification_via_manipulated_button(self):
        """The notification list only ever renders the current user's own
        rows (button keys are derived from db.list_notifications_by_user(),
        which is already scoped by user_id) -- so there is no in-page
        button that maps to another user's notification id. This directly
        confirms mark_notification_as_read() itself blocks it regardless."""
        db.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        b_notification = db.list_notifications_by_user(self.userB)[0]

        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            self.assertFalse(
                any(b.key == f"notif_confirm_{b_notification['id']}" for b in at.button)
            )

        with self.assertRaises(db.PermissionDeniedError):
            db.mark_notification_as_read(b_notification["id"], self.userA)

    # ---------- personal info ----------

    def test_no_email_or_real_name_leaked_in_notifications(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        room = db.get_or_create_chat_room(match_id, self.userA)
        db.send_message(room["id"], self.userA, "안녕하세요")

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        page_text = " ".join(str(m.value) for m in at.markdown)
        self.assertNotIn("usera@mju.ac.kr", page_text)
        self.assertNotIn("사용자A실명", page_text)
        self.assertIn("사용자A닉", page_text)

    # ---------- pagination ----------

    def test_pagination_next_and_prev(self):
        # 25 distinct "match" notifications for userA (PAGE_SIZE is 20).
        for i in range(25):
            other_user = db.create_user(f"matcher{i}@mju.ac.kr", f"매처{i}")
            db.set_initial_nickname(other_user, f"매처{i}닉")
            lp = db.create_lost_post(self.userA, f"제목{i}", "설명", "기타", "장소", "2026-08-20 10:00")
            fp = db.create_found_post(other_user, f"습득{i}", "설명", "기타", "장소", "2026-08-20 11:00")
            db.create_match(lp, fp, 0.5, self.userA)

        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            self.assertTrue(at.button(key="notif_page_prev").disabled)  # page 0: no previous page
            self.assertFalse(at.button(key="notif_page_next").disabled)  # 25 > PAGE_SIZE(20): more exist

            at.button(key="notif_page_next").click()
            at.run(timeout=30)
            self.assertFalse(at.button(key="notif_page_prev").disabled)
            self.assertTrue(at.button(key="notif_page_next").disabled)  # page 1 has the remaining 5

        self.assertEqual(list(at.exception), [])

    # ---------- click routing ----------

    def test_match_notification_routes_to_my_matches_page(self):
        db.create_match(self.lost_id, self.found_id, 0.9, self.userA)

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            n = next(n for n in db.list_notifications_by_user(self.userB) if n["type"] == "match")

            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"notif_confirm_{n['id']}").click()
                at.run(timeout=30)

        mock_switch.assert_called_once_with("pages/4_내_매칭.py")
        self.assertEqual(db.get_notification(n["id"])["is_read"], 1)

    def test_message_notification_routes_to_chat_page_with_correct_room(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        room = db.get_or_create_chat_room(match_id, self.userA)
        db.send_message(room["id"], self.userA, "안녕하세요")

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            n = next(n for n in db.list_notifications_by_user(self.userB) if n["type"] == "message")

            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"notif_confirm_{n['id']}").click()
                at.run(timeout=30)

        mock_switch.assert_called_once_with("pages/5_채팅.py")
        self.assertEqual(at.session_state["chat_room_id"], room["id"])
        self.assertEqual(db.get_notification(n["id"])["is_read"], 1)

    def test_message_notification_click_still_gated_by_real_participant_check(self):
        """related_id is resolved to a chat_room_id here, but the actual
        access check happens again in pages/5_채팅.py's get_chat_room() --
        confirmed by exercising that page directly with the routed room id
        for a genuine participant (userB), which must succeed cleanly."""
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        room = db.get_or_create_chat_room(match_id, self.userA)
        db.send_message(room["id"], self.userA, "안녕하세요")

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any("권한이 없습니다" in str(e.value) for e in at.error))

    def test_report_related_notification_stays_on_notification_page(self):
        report_id = db.create_report(self.userB, "post", self.lost_id, "기타")
        admin = db.create_user("admin2@mju.ac.kr", "관리자2실명")
        db.set_initial_nickname(admin, "관리자2닉")
        with db.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (admin,))
        db.process_report(report_id, admin, "dismissed")  # notifies userB (report_processed)

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(NOTIF_PAGE)
            at.run(timeout=30)
            n = next(
                n for n in db.list_notifications_by_user(self.userB) if n["type"] == "report_processed"
            )
            at.button(key=f"notif_confirm_{n['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.get_notification(n["id"])["is_read"], 1)
        # still on the notification page -- no navigation target for "report"
        self.assertTrue(any("알림" in str(t.value) for t in at.title))


if __name__ == "__main__":
    unittest.main()
